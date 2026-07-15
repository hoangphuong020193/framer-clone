/**
 * Structural validation only (non-empty string, http(s) protocol) — the
 * deeper same-origin/SSRF checks happen inside the capture pipeline itself
 * for every request it actually makes.
 */
export function parseCaptureUrl(body: unknown): URL | null {
  if (typeof body !== 'object' || body === null) return null
  const url = (body as Record<string, unknown>).url
  if (typeof url !== 'string') return null

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}
