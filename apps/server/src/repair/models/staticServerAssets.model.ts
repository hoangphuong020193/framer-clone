/**
 * Minimal, dependency-free static file server bundled into every archive
 * (Phase 4) so it works when served locally instead of pointing back at the
 * live site. Written in CommonJS and shipped as `serve.cjs` (not `.js`) so it
 * runs as CommonJS unconditionally — a bare `.js` file's module type is
 * inherited from the nearest ancestor `package.json`, which could set
 * `"type": "module"` if this archive is ever extracted inside another Node
 * project; `.cjs` isn't subject to that lookup.
 * Resolves extensionless request paths to `index.html` — this is what lets
 * repaired same-origin links stay as clean paths (`/about`) instead of the
 * underlying on-disk file layout (`/about/index.html`).
 */
export const STATIC_SERVER_SOURCE = `#!/usr/bin/env node
// Minimal static file server for browsing this captured site archive.
// Usage: node serve.cjs [port]
const http = require('http')
const fs = require('fs')
const path = require('path')

const port = Number(process.argv[2]) || 8080
const root = __dirname

const MIME_TYPES = {
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

function withinRoot(candidate) {
  return candidate === root || candidate.startsWith(root + path.sep)
}

function resolveFile(requestPath) {
  let decoded
  try {
    decoded = decodeURIComponent(requestPath.split('?')[0].split('#')[0])
  } catch {
    return null
  }
  const candidates = decoded.endsWith('/')
    ? [decoded + 'index.html']
    : [decoded, decoded + '/index.html', decoded + '.html']

  for (const candidate of candidates) {
    const full = path.join(root, candidate)
    if (!withinRoot(full)) continue
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full
  }
  return null
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url || '/')
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }
  const ext = path.extname(file).toLowerCase()
  res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

server.listen(port, () => {
  console.log(\`Serving this archive at http://localhost:\${port}\`)
})
`

export const STATIC_SERVER_README = `# Captured site archive

This folder is an offline snapshot captured from the live site.

## Browsing locally

    node serve.cjs [port]

Then open http://localhost:8080 (or your chosen port) in a browser.

## Known limitations

- Embedded forms and third-party widgets will not function offline.
- CMS content is a frozen snapshot from capture time, not live data.
- Analytics/editor-bridge scripts were removed since they cannot reach their live endpoints offline.
- Pages or assets skipped by a partial capture (timeout or size cap) still link to the live site rather than a broken local path.
`
