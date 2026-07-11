import crypto from 'node:crypto'
import path from 'node:path'

// Windows reserved device names — invalid as a path segment regardless of extension.
const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

// Keep segments well under Windows' 260-char full-path limit even after
// nesting several directories deep.
const MAX_SEGMENT_LENGTH = 100

function sanitizeSegment(rawSegment: string): string {
  let safe = decodeSegmentSafely(rawSegment)
  // Windows-invalid characters, control characters, and path separators.
  // Separators must be stripped *after* decoding: the URL parser leaves
  // percent-encoded "%2f"/"%5c" undecoded specifically so a single path
  // segment can't smuggle in a new separator — decodeSegmentSafely above
  // reverses that protection, so this segment can otherwise end up
  // containing a real "/" or "\" that escapes the intended directory when
  // later joined into a filesystem path (e.g. "..%2f..%2fetc%2fpasswd").
  safe = safe.replace(/[<>:"|?*/\\\x00-\x1f]/g, '_')
  // Trailing dots/spaces are stripped by Windows and can cause surprising collisions.
  safe = safe.replace(/[. ]+$/g, '_')
  if (safe === '' || safe === '.' || safe === '..') safe = '_'

  const ext = path.extname(safe)
  const stem = ext ? safe.slice(0, -ext.length) : safe
  if (WINDOWS_RESERVED_NAMES.has(stem.toLowerCase())) {
    safe = `_${safe}`
  }

  if (safe.length > MAX_SEGMENT_LENGTH) {
    const hash = crypto.createHash('sha1').update(rawSegment).digest('hex').slice(0, 8)
    const currentExt = path.extname(safe)
    const budget = MAX_SEGMENT_LENGTH - hash.length - currentExt.length - 1
    safe = `${safe.slice(0, Math.max(budget, 1))}-${hash}${currentExt}`
  }

  return safe
}

function decodeSegmentSafely(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function queryFingerprint(search: string): string {
  if (!search) return ''
  return `__q-${crypto.createHash('sha1').update(search).digest('hex').slice(0, 10)}`
}

/**
 * Maps a captured URL to a local relative path within the archive workspace.
 *
 * Same-origin URLs (the site being captured) map directly by path from the
 * workspace root — `/about` -> `about/index.html` — so the bundled static
 * server can serve the workspace root as the site itself. Cross-origin URLs
 * (CDN assets, analytics) are mirrored under a per-hostname subdirectory so
 * they can never collide with the site's own path namespace.
 *
 * The query string is folded into the filename (not dropped) because Framer's
 * image CDN returns different bytes for different `?width=/&height=` values —
 * treating the path alone as the resource identity would silently collide
 * distinct resolutions onto one file.
 */
export function urlToLocalPath(url: URL, siteOrigin: string): string {
  const isSameOrigin = url.origin === siteOrigin
  const rawSegments = url.pathname.split('/').filter((s) => s.length > 0)
  const segments = rawSegments.map(sanitizeSegment)
  const fingerprint = queryFingerprint(url.search)

  let relativePath: string
  if (segments.length === 0) {
    relativePath = 'index.html'
  } else {
    const last = segments[segments.length - 1]
    const hasExtension = /\.[a-zA-Z0-9]{1,8}$/.test(last)
    if (hasExtension) {
      const ext = path.extname(last)
      const stem = last.slice(0, -ext.length)
      segments[segments.length - 1] = `${stem}${fingerprint}${ext}`
      relativePath = segments.join('/')
    } else {
      segments[segments.length - 1] = `${last}${fingerprint}`
      relativePath = [...segments, 'index.html'].join('/')
    }
  }

  if (isSameOrigin) return relativePath
  return [sanitizeSegment(url.hostname), relativePath].join('/')
}
