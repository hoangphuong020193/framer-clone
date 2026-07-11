import type { Browser } from 'playwright'
import type { DiscoveryResult } from '../models/browserDiscovery.model.js'
import type { FetchDeps } from '../models/fetchResource.model.js'
import { resolveSafeFetchTarget } from './ssrf.service.js'

const NAVIGATION_TIMEOUT_MS = 15000
const SETTLE_AFTER_SCROLL_MS = 1500

/**
 * Single lightweight Playwright pass over a page — discovery only, not a
 * capture path. Finds what a plain HTTP fetch can't: lazy-mounted/scroll-
 * triggered requests and same-origin links rendered by client-side JS.
 *
 * Known limitation: `page.goto` and any request the page's own JavaScript
 * issues (fetch/XHR/img/iframe) run through Chromium's own network stack,
 * entirely outside our Node-side SSRF dispatcher pinning. We validate the
 * top-level URL before navigating, and additionally re-validate every
 * sub-request through `context.route()` below — Chromium still does its own
 * DNS resolution per request, so a low-TTL DNS-rebind between our check and
 * Chromium's connect is not fully closed, but this blocks the common case
 * (a page whose JS tries to reach a private/internal address directly) and
 * ensures a blocked target's response body never reaches this pass. As a
 * second layer, any resource this pass *does* observe is independently
 * re-validated and re-fetched through the guarded path before being
 * persisted, so a successful rebind here still cannot get attacker-reachable
 * bytes into the archive.
 */
export async function discoverPage(
  browser: Browser,
  pageUrl: string,
  siteOrigin: string,
  deps: FetchDeps = {},
): Promise<DiscoveryResult> {
  const resolveTarget = deps.resolveTarget ?? resolveSafeFetchTarget
  await resolveTarget(pageUrl) // throws SsrfBlockedError if unsafe; dispatcher unused here.

  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const observedResourceUrls = new Set<string>()
    const rangeRequestedUrls = new Set<string>()

    page.on('response', (response) => {
      const status = response.status()
      if (status >= 300 && status < 400) return // intermediate redirect hop; final response fires separately
      if (status === 206) {
        rangeRequestedUrls.add(response.url())
        return
      }
      observedResourceUrls.add(response.url())
    })

    // Re-validate every request this page makes — not just the initial
    // navigation — since the page's own JS can pivot to an internal target
    // after load (see the known-limitation note above).
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url()
      if (requestUrl.startsWith('data:') || requestUrl.startsWith('blob:') || requestUrl.startsWith('about:')) {
        await route.continue()
        return
      }
      try {
        await resolveTarget(requestUrl)
        await route.continue()
      } catch {
        await route.abort('blockedbyclient')
      }
    })

    try {
      await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: NAVIGATION_TIMEOUT_MS })
    } catch {
      // Per-page timeout guard — proceed with whatever was observed rather than stalling the crawl worker.
    }

    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(SETTLE_AFTER_SCROLL_MS)
      await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT_MS })
    } catch {
      // Best effort — scroll-triggered requests may not fully settle on slow/polling pages.
    }

    const sameOriginLinks = await page.evaluate((origin) => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => {
          try {
            return new URL(href).origin === origin
          } catch {
            return false
          }
        })
    }, siteOrigin)

    const renderedHtml = await page.content()

    return { observedResourceUrls, rangeRequestedUrls, sameOriginLinks, renderedHtml }
  } finally {
    await context.close()
  }
}
