/**
 * Normalizes a page URL for crawl-queue dedup: strips the fragment (which
 * never identifies a distinct server-rendered page) and trailing slashes
 * (so "/about" and "/about/" collapse to one queue entry instead of being
 * crawled as two separate pages). Returns null for anything that isn't a
 * same-origin http(s) URL — cross-origin links are never crawl targets.
 */
export function normalizePageUrl(rawUrl: string, siteOrigin: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.origin !== siteOrigin) return null
  url.hash = ''
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1)
  }
  return url.toString()
}
