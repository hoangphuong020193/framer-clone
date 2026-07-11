import { Agent } from 'undici'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SafeFetchTarget } from '../../capture/models/ssrf.model.js'
import { startFixtureServer, type FixtureServer, type RouteHandler } from '../../capture/testUtils/fixtureServer.js'
import { discoverSitemapUrls } from './sitemap.service.js'

const permissiveResolver = async (rawUrl: string): Promise<SafeFetchTarget> => ({
  url: new URL(rawUrl),
  dispatcher: new Agent(),
})

describe('discoverSitemapUrls', () => {
  let server: FixtureServer

  beforeAll(async () => {
    server = await startFixtureServer({
      '/sitemap.xml': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/xml' })
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
          <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>${server.baseUrl}/</loc></url>
            <url><loc>${server.baseUrl}/about</loc></url>
            <url><loc>https://external.example.com/should-be-excluded</loc></url>
            <url><loc>not a valid url</loc></url>
          </urlset>`)
      },
    })
  })

  afterAll(async () => {
    await server.close()
  })

  it('returns every same-origin <loc> from the flat sitemap, excluding cross-origin and malformed entries', async () => {
    const urls = await discoverSitemapUrls(server.baseUrl, { resolveTarget: permissiveResolver })
    expect(urls.sort()).toEqual([`${server.baseUrl}/`, `${server.baseUrl}/about`].sort())
  })

  it('returns an empty array (not a throw) when there is no sitemap.xml', async () => {
    const urls = await discoverSitemapUrls('http://does-not-matter.invalid', {
      resolveTarget: async () => {
        throw new Error('no sitemap here')
      },
    })
    expect(urls).toEqual([])
  })
})

describe('discoverSitemapUrls (sitemap index)', () => {
  it('follows one level of <sitemapindex> nesting to collect URLs from the nested sitemap', async () => {
    const server = await startFixtureServer({
      '/sitemap.xml': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/xml' })
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
          <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <sitemap><loc>${server.baseUrl}/nested.xml</loc></sitemap>
          </sitemapindex>`)
      },
      '/nested.xml': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/xml' })
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
          <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>${server.baseUrl}/from-nested</loc></url>
          </urlset>`)
      },
    })
    try {
      const urls = await discoverSitemapUrls(server.baseUrl, { resolveTarget: permissiveResolver })
      expect(urls).toEqual([`${server.baseUrl}/from-nested`])
    } finally {
      await server.close()
    }
  })

  it('does not re-fetch the same nested sitemap URL twice when two index entries point at it', async () => {
    let nestedFetchCount = 0
    const server = await startFixtureServer({
      '/sitemap.xml': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/xml' })
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
          <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <sitemap><loc>${server.baseUrl}/nested.xml</loc></sitemap>
            <sitemap><loc>${server.baseUrl}/nested.xml</loc></sitemap>
          </sitemapindex>`)
      },
      '/nested.xml': (_req, res) => {
        nestedFetchCount += 1
        res.writeHead(200, { 'content-type': 'application/xml' })
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
          <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>${server.baseUrl}/from-nested</loc></url>
          </urlset>`)
      },
    })
    try {
      const urls = await discoverSitemapUrls(server.baseUrl, { resolveTarget: permissiveResolver })
      expect(urls).toEqual([`${server.baseUrl}/from-nested`])
      expect(nestedFetchCount).toBe(1)
    } finally {
      await server.close()
    }
  })

  it('caps total sitemap document fetches so a wide sitemap index cannot cause unbounded fan-out', async () => {
    let fetchCount = 0
    const paths: Record<string, RouteHandler> = {}
    const NUM_NESTED = 200

    paths['/sitemap.xml'] = (_req, res) => {
      const entries = Array.from({ length: NUM_NESTED }, (_, i) => `<sitemap><loc>${server.baseUrl}/nested-${i}.xml</loc></sitemap>`).join('')
      res.writeHead(200, { 'content-type': 'application/xml' })
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`,
      )
    }
    for (let i = 0; i < NUM_NESTED; i++) {
      paths[`/nested-${i}.xml`] = (_req, res) => {
        fetchCount += 1
        res.writeHead(200, { 'content-type': 'application/xml' })
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${server.baseUrl}/page-${i}</loc></url></urlset>`,
        )
      }
    }

    const server = await startFixtureServer(paths)
    try {
      await discoverSitemapUrls(server.baseUrl, { resolveTarget: permissiveResolver })
      // 1 fetch for the top-level index + at most (MAX_SITEMAP_FETCHES - 1) nested fetches.
      expect(fetchCount).toBeLessThan(NUM_NESTED)
    } finally {
      await server.close()
    }
  })
})
