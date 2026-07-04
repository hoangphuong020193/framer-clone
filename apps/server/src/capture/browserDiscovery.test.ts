import { chromium, type Browser } from 'playwright'
import { Agent } from 'undici'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { discoverPage } from './browserDiscovery.js'
import { SsrfBlockedError, type SafeFetchTarget } from './ssrf.js'
import { startFixtureServer, type FixtureServer } from './testUtils/fixtureServer.js'

const permissiveResolver = async (rawUrl: string): Promise<SafeFetchTarget> => ({
  url: new URL(rawUrl),
  dispatcher: new Agent(),
})

describe('discoverPage', () => {
  let browser: Browser
  let server: FixtureServer
  let internalSecretHits = 0

  beforeAll(async () => {
    browser = await chromium.launch()
    server = await startFixtureServer({
      '/page-with-js-pivot': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(`
          <html><body>
            <script>fetch('/internal-secret').catch(() => {})</script>
          </body></html>
        `)
      },
      '/internal-secret': (_req, res) => {
        internalSecretHits++
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('should never be reached')
      },
      '/page': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(`
          <html><body>
            <a href="/other">Other page</a>
            <a href="https://external.example.com/">External</a>
            <img src="/lazy.png">
            <img src="/always-206">
          </body></html>
        `)
      },
      '/other': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>other</body></html>')
      },
      '/lazy.png': (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      },
      '/always-206': (_req, res) => {
        res.writeHead(206, { 'content-type': 'image/png', 'content-range': 'bytes 0-3/10' })
        res.end(Buffer.from([1, 2, 3, 4]))
      },
    })
  })

  afterAll(async () => {
    await browser.close()
    await server.close()
  })

  it('collects same-origin links and excludes cross-origin ones', async () => {
    const result = await discoverPage(browser, `${server.baseUrl}/page`, server.baseUrl, {
      resolveTarget: permissiveResolver,
    })
    expect(result.sameOriginLinks).toEqual([`${server.baseUrl}/other`])
  })

  it('observes normally-loaded resources', async () => {
    const result = await discoverPage(browser, `${server.baseUrl}/page`, server.baseUrl, {
      resolveTarget: permissiveResolver,
    })
    expect(result.observedResourceUrls.has(`${server.baseUrl}/lazy.png`)).toBe(true)
  })

  it('routes 206 Partial Content responses to rangeRequestedUrls, not observedResourceUrls', async () => {
    const result = await discoverPage(browser, `${server.baseUrl}/page`, server.baseUrl, {
      resolveTarget: permissiveResolver,
    })
    expect(result.rangeRequestedUrls.has(`${server.baseUrl}/always-206`)).toBe(true)
    expect(result.observedResourceUrls.has(`${server.baseUrl}/always-206`)).toBe(false)
  })

  it('captures the rendered HTML content', async () => {
    const result = await discoverPage(browser, `${server.baseUrl}/page`, server.baseUrl, {
      resolveTarget: permissiveResolver,
    })
    expect(result.renderedHtml).toContain('Other page')
  })

  it('aborts a request the page\'s own JavaScript makes to a blocked target, not just the top-level navigation', async () => {
    const blockingResolver = async (rawUrl: string): Promise<SafeFetchTarget> => {
      if (rawUrl.includes('/internal-secret')) {
        throw new SsrfBlockedError(`Blocked ${rawUrl}`)
      }
      return permissiveResolver(rawUrl)
    }

    const result = await discoverPage(browser, `${server.baseUrl}/page-with-js-pivot`, server.baseUrl, {
      resolveTarget: blockingResolver,
    })

    expect(internalSecretHits).toBe(0)
    expect([...result.observedResourceUrls]).not.toContain(`${server.baseUrl}/internal-secret`)
  })
})
