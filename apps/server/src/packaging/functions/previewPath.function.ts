import path from 'node:path'

/**
 * Maps a preview request path to the ordered list of candidate absolute file
 * paths inside `siteDir`, mirroring the bundled static server's resolution
 * (`/` and directory paths → `index.html`, extensionless → `.html`). Every
 * candidate is verified to stay within `siteDir` — defense-in-depth against
 * `..` traversal even after URL-decoding — so a decode failure or any escaping
 * candidate is dropped. Pure: does no filesystem I/O (the caller stats each).
 */
export function resolvePreviewCandidates(siteDir: string, requestPath: string): string[] {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath.split('?')[0].split('#')[0])
  } catch {
    return []
  }

  if (decoded === '') decoded = '/'

  const relatives = decoded.endsWith('/')
    ? [`${decoded}index.html`]
    : [decoded, `${decoded}/index.html`, `${decoded}.html`]

  const root = path.resolve(siteDir)
  const candidates: string[] = []
  for (const rel of relatives) {
    const normalized = rel.startsWith('/') ? rel : `/${rel}`
    const full = path.resolve(root, `.${normalized}`)
    if (full === root || full.startsWith(root + path.sep)) candidates.push(full)
  }
  return candidates
}
