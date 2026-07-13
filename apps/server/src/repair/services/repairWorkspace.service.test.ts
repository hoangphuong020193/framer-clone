import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { repairWorkspace } from './repairWorkspace.service.js'

const SITE_ORIGIN = 'https://example.framer.website'

describe('repairWorkspace', () => {
  let siteDir: string

  beforeEach(async () => {
    siteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repair-workspace-'))
  })

  afterEach(async () => {
    await fs.rm(siteDir, { recursive: true, force: true })
  })

  it('rewrites captured asset/link references and leaves uncaptured ones untouched', async () => {
    await fs.mkdir(path.join(siteDir, 'framerusercontent.com', 'images'), { recursive: true })
    await fs.writeFile(path.join(siteDir, 'framerusercontent.com', 'images', 'pic.png'), 'binarydata')

    await fs.mkdir(path.join(siteDir, 'about'), { recursive: true })
    await fs.writeFile(path.join(siteDir, 'about', 'index.html'), '<html><body>About</body></html>')

    await fs.writeFile(
      path.join(siteDir, 'index.html'),
      `<html><body>
        <img src="https://framerusercontent.com/images/pic.png">
        <img src="https://framerusercontent.com/images/missing.png">
        <a href="${SITE_ORIGIN}/about">About</a>
        <a href="${SITE_ORIGIN}/skipped">Skipped</a>
      </body></html>`,
    )

    const result = await repairWorkspace(siteDir, SITE_ORIGIN)

    expect(result.htmlFilesRepaired).toBe(2)

    const rewritten = await fs.readFile(path.join(siteDir, 'index.html'), 'utf-8')
    expect(rewritten).toContain('src="/framerusercontent.com/images/pic.png"')
    expect(rewritten).toContain('src="https://framerusercontent.com/images/missing.png"')
    expect(rewritten).toContain('href="/about"')
    expect(rewritten).toContain(`href="${SITE_ORIGIN}/skipped"`)
  })

  it('bundles a static server and README into the workspace', async () => {
    await fs.writeFile(path.join(siteDir, 'index.html'), '<html><body>Home</body></html>')

    await repairWorkspace(siteDir, SITE_ORIGIN)

    const serveJs = await fs.readFile(path.join(siteDir, 'serve.cjs'), 'utf-8')
    const readme = await fs.readFile(path.join(siteDir, 'README.md'), 'utf-8')
    expect(serveJs).toContain('http.createServer')
    expect(readme).toContain('node serve.cjs')
  })

  it('returns zero repaired files for a workspace with no HTML', async () => {
    await fs.mkdir(path.join(siteDir, 'framerusercontent.com'), { recursive: true })
    await fs.writeFile(path.join(siteDir, 'framerusercontent.com', 'pic.png'), 'data')

    const result = await repairWorkspace(siteDir, SITE_ORIGIN)

    expect(result.htmlFilesRepaired).toBe(0)
  })
})
