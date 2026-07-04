import * as cheerio from 'cheerio'

export type ResourceKind = 'image' | 'script' | 'stylesheet-link' | 'other'

export interface ScannedResource {
  absoluteUrl: string
  kind: ResourceKind
}

const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g

function addUrl(
  found: Map<string, ResourceKind>,
  raw: string | undefined,
  baseUrl: string,
  kind: ResourceKind,
): void {
  if (!raw || raw.startsWith('data:')) return
  try {
    const absolute = new URL(raw, baseUrl).toString()
    if (!found.has(absolute)) found.set(absolute, kind)
  } catch {
    // Malformed URL in source markup — nothing to fetch, skip.
  }
}

function scanCssTextForUrls(found: Map<string, ResourceKind>, cssText: string, baseUrl: string): void {
  for (const match of cssText.matchAll(CSS_URL_PATTERN)) {
    addUrl(found, match[2], baseUrl, 'image')
  }
}

/**
 * Enumerates statically-declared resource references in raw (un-executed)
 * HTML — the HTTP-first capture path. Covers what Phase 0's real-site spike
 * found: `<img>` src/srcset, `modulepreload` script chunks, stylesheet
 * links, icons, and `url(...)` references inside inline `<style>` blocks and
 * `style=""` attributes (Framer inlines all CSS server-side; there are no
 * separate stylesheet assets to fetch on top of this).
 */
export function scanHtmlForResources(html: string, baseUrl: string): ScannedResource[] {
  const $ = cheerio.load(html)
  const found = new Map<string, ResourceKind>()

  $('img[src]').each((_, el) => addUrl(found, $(el).attr('src'), baseUrl, 'image'))
  $('img[srcset], source[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset') ?? ''
    for (const part of srcset.split(',')) {
      const url = part.trim().split(/\s+/)[0]
      addUrl(found, url, baseUrl, 'image')
    }
  })
  $('script[src]').each((_, el) => addUrl(found, $(el).attr('src'), baseUrl, 'script'))
  $('link[rel="modulepreload"][href]').each((_, el) => addUrl(found, $(el).attr('href'), baseUrl, 'script'))
  $('link[rel="stylesheet"][href]').each((_, el) => addUrl(found, $(el).attr('href'), baseUrl, 'stylesheet-link'))
  $('link[rel="icon"][href], link[rel="shortcut icon"][href], link[rel="apple-touch-icon"][href]').each((_, el) =>
    addUrl(found, $(el).attr('href'), baseUrl, 'image'),
  )
  $('source[src]').each((_, el) => addUrl(found, $(el).attr('src'), baseUrl, 'other'))
  $('video[poster]').each((_, el) => addUrl(found, $(el).attr('poster'), baseUrl, 'image'))

  $('style').each((_, el) => scanCssTextForUrls(found, $(el).html() ?? '', baseUrl))
  $('[style]').each((_, el) => scanCssTextForUrls(found, $(el).attr('style') ?? '', baseUrl))

  return [...found.entries()].map(([absoluteUrl, kind]) => ({ absoluteUrl, kind }))
}
