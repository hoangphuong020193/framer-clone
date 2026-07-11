import * as cheerio from 'cheerio'
import type { FetchDeps } from '../../capture/models/fetchResource.model.js'
import { fetchRaw } from '../../capture/services/fetchResource.service.js'
import type { SitemapCrawlState } from '../models/crawl.model.js'

// Guards against a malicious/misconfigured sitemap index chaining into itself
// or an unbounded number of nested sitemaps.
const MAX_SITEMAP_INDEX_DEPTH = 3

// Depth alone doesn't bound total work — a sitemap index can list hundreds of
// <sitemap> entries per level, so a wide (not just deep) index can still
// cause exponential fetch blowup. This caps total sitemap document fetches
// across the whole discovery run, independent of nesting shape.
const MAX_SITEMAP_FETCHES = 50

/**
 * Fetches `${siteOrigin}/sitemap.xml` (Framer auto-generates one, including
 * CMS pages that aren't linked via `<a>` tags) and returns every same-origin
 * URL it lists, following one level of `<sitemapindex>` nesting if present.
 * Returns an empty array — never throws — if there's no sitemap, so the
 * crawl always falls back to link discovery alone.
 */
export async function discoverSitemapUrls(siteOrigin: string, deps: FetchDeps = {}): Promise<string[]> {
  const state: SitemapCrawlState = { found: new Set(), visited: new Set(), fetchCount: 0 }
  await collectSitemapUrls(new URL('/sitemap.xml', siteOrigin).toString(), siteOrigin, deps, state, 0)
  return [...state.found]
}

async function collectSitemapUrls(
  sitemapUrl: string,
  siteOrigin: string,
  deps: FetchDeps,
  state: SitemapCrawlState,
  depth: number,
): Promise<void> {
  if (depth > MAX_SITEMAP_INDEX_DEPTH) return
  if (state.fetchCount >= MAX_SITEMAP_FETCHES) return
  if (state.visited.has(sitemapUrl)) return
  state.visited.add(sitemapUrl)
  state.fetchCount += 1

  let xml: string
  try {
    const fetched = await fetchRaw(sitemapUrl, deps)
    if (fetched.status !== 200) return
    xml = fetched.body.toString('utf-8')
  } catch {
    return
  }

  const $ = cheerio.load(xml, { xmlMode: true })

  const nestedSitemaps = $('sitemapindex > sitemap > loc')
    .map((_, el) => $(el).text().trim())
    .get()
  for (const nested of nestedSitemaps) {
    if (state.fetchCount >= MAX_SITEMAP_FETCHES) break
    await collectSitemapUrls(nested, siteOrigin, deps, state, depth + 1)
  }

  $('urlset > url > loc')
    .map((_, el) => $(el).text().trim())
    .get()
    .forEach((loc) => {
      try {
        const url = new URL(loc)
        if (url.origin === siteOrigin) state.found.add(url.toString())
      } catch {
        // Malformed <loc> entry — skip it rather than failing the whole sitemap.
      }
    })
}
