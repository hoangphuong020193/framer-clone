/**
 * Content types for files served read-only from a retained workspace by the
 * preview endpoint. Mirrors the bundled `serve.cjs` table so the in-app preview
 * and the downloaded archive resolve the same types.
 */
export const PREVIEW_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

export const PREVIEW_MIME_FALLBACK = 'application/octet-stream'

export interface ResolvedPreviewFile {
  contentType: string
  /** HTML is a rewritten string (root-relative URLs prefixed); other assets are raw bytes. */
  body: Buffer | string
}
