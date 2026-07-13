import { urlToLocalPath } from '../../capture/functions/urlPathMapping.function.js'
import type { IsCapturedFn } from '../models/repair.model.js'

/**
 * Resolves an absolute URL found in captured markup to a root-relative local
 * file path — but only if a file was actually captured for it. Returns null
 * otherwise so the caller leaves the original absolute URL untouched: a
 * partial (timed-out or budget-capped) crawl must degrade gracefully rather
 * than produce a local reference that 404s.
 */
export function resolveCapturedAssetPath(
  absoluteUrl: string,
  siteOrigin: string,
  isCaptured: IsCapturedFn,
): string | null {
  let url: URL
  try {
    url = new URL(absoluteUrl)
  } catch {
    return null
  }
  const localPath = urlToLocalPath(url, siteOrigin)
  if (!isCaptured(localPath)) return null
  return `/${localPath}`
}

/**
 * Same-origin page links resolve to a root-relative *request* path (origin
 * stripped, path/query/hash preserved) rather than the underlying
 * `index.html` file path — the bundled static server resolves extensionless
 * paths to `index.html` at request time, so `/about` stays `/about` instead
 * of surfacing the on-disk layout.
 */
export function resolveCapturedLinkPath(
  absoluteUrl: string,
  siteOrigin: string,
  isCaptured: IsCapturedFn,
): string | null {
  let url: URL
  try {
    url = new URL(absoluteUrl)
  } catch {
    return null
  }
  if (url.origin !== siteOrigin) return null
  const localPath = urlToLocalPath(url, siteOrigin)
  if (!isCaptured(localPath)) return null
  return `${url.pathname}${url.search}${url.hash}`
}
