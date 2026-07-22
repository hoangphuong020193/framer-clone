import { fetch as undiciFetch } from 'undici'
import type { FetchDeps, FetchedResource } from '../models/fetchResource.model.js'
import { resolveSafeFetchTarget } from './ssrf.service.js'

const MAX_REDIRECTS = 5
// Per-resource safety cap so a malicious/misbehaving origin can't exhaust
// server memory with an oversized (or falsely-labeled) response body. Real
// per-type/per-workspace budgets are a Phase 3 concern; this is the backstop.
const MAX_RESPONSE_BYTES = 200 * 1024 * 1024

// A real browser User-Agent + Accept headers. Some CDN edges (Framer's
// included) answer header-less requests with a bot challenge or a redirect
// loop, which would otherwise surface as a spurious capture failure.
const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
}

/**
 * Fetches a URL's raw response body, following redirects manually so the
 * SSRF guard re-validates every hop's target (a redirect to an internal
 * address must be blocked just as the original URL would be — letting fetch
 * auto-follow would connect to an unvalidated host).
 */
export async function fetchRaw(rawUrl: string, deps: FetchDeps = {}): Promise<FetchedResource> {
  const resolveTarget = deps.resolveTarget ?? resolveSafeFetchTarget
  const maxResponseBytes = deps.maxResponseBytes ?? MAX_RESPONSE_BYTES
  const redirectChain: string[] = []
  let currentUrl = rawUrl

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
    const { url, dispatcher } = await resolveTarget(currentUrl)
    const response = await undiciFetch(url, { redirect: 'manual', dispatcher, headers: BROWSER_HEADERS })

    if (response.status >= 300 && response.status < 400) {
      if (attempt === MAX_REDIRECTS) {
        throw new Error(`Too many redirects starting from ${rawUrl} (max ${MAX_REDIRECTS})`)
      }
      const location = response.headers.get('location')
      if (!location) {
        throw new Error(`Redirect from ${currentUrl} had no Location header`)
      }
      redirectChain.push(currentUrl)
      currentUrl = new URL(location, url).toString()
      continue
    }

    const body = await readBodyWithCap(response, maxResponseBytes)
    return {
      finalUrl: url.toString(),
      status: response.status,
      contentType: response.headers.get('content-type'),
      body,
      redirectChain,
    }
  }

  throw new Error(`Too many redirects starting from ${rawUrl} (max ${MAX_REDIRECTS})`)
}

async function readBodyWithCap(
  response: Awaited<ReturnType<typeof undiciFetch>>,
  capBytes: number,
): Promise<Buffer> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength && Number(declaredLength) > capBytes) {
    throw new Error(`Response body exceeds ${capBytes}-byte cap (Content-Length: ${declaredLength})`)
  }
  if (!response.body) return Buffer.alloc(0)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > capBytes) {
      await reader.cancel()
      throw new Error(`Response body exceeds ${capBytes}-byte cap`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}
