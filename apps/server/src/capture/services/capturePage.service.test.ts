import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { Agent } from 'undici'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SafeFetchTarget } from '../models/ssrf.model.js'
import { startFixtureServer, type FixtureServer } from '../testUtils/fixtureServer.js'
import { capturePage } from './capturePage.service.js'
import { ResourceStore } from './resourceStore.service.js'

const permissiveResolver = async (rawUrl: string): Promise<SafeFetchTarget> => ({
  url: new URL(rawUrl),
  dispatcher: new Agent(),
})

const HOME_HTML = `<!doctype html><html><body>
  <div data-framer-appear-id="hero" style="opacity:0.001;transform:translateY(50px)">Hero</div>
  <img src="/hero.png">
  <a href="/about">About</a>
</body></html>`

describe('capturePage', () => {
  let browser: Browser
  let server: FixtureServer
  let workDir: string

  beforeAll(async () => {
    browser = await chromium.launch()
    server = await startFixtureServer({
      '/': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(HOME_HTML)
      },
      '/about': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>About page</body></html>')
      },
      '/hero.png': (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      },
    })
  })

  afterAll(async () => {
    await browser.close()
    await server.close()
  })

  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true })
  })

  it('captures raw HTML byte-for-byte, persists resources, finds links, and keeps the DOM snapshot out of the archive tree', async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'capture-page-'))
    const siteDir = path.join(workDir, 'site')
    const metaDir = path.join(workDir, '_meta')
    const store = new ResourceStore(siteDir)

    const result = await capturePage({
      pageUrl: `${server.baseUrl}/`,
      siteOrigin: server.baseUrl,
      siteDir,
      metaDir,
      store,
      browser,
      fetchDeps: { resolveTarget: permissiveResolver },
    })

    expect(result.status).toBe('captured')
    expect(result.warnings).toEqual([])

    // Raw-capture invariant: bytes on disk match the fixture byte-for-byte.
    const persistedHtml = await readFile(path.join(siteDir, result.localHtmlPath!), 'utf-8')
    expect(persistedHtml).toBe(HOME_HTML)
    expect(persistedHtml).toContain('opacity:0.001') // appear-effect hidden state survives untouched

    const heroResource = result.resources.find((r) => r.url === `${server.baseUrl}/hero.png`)
    expect(heroResource).toBeDefined()
    await expect(readFile(path.join(siteDir, heroResource!.localPath))).resolves.toBeInstanceOf(Buffer)

    expect(result.sameOriginLinks).toContain(`${server.baseUrl}/about`)

    // Rendered DOM snapshot exists, but strictly outside the archive (site/) tree.
    expect(result.renderedDomPath).not.toBeNull()
    const snapshotFullPath = path.join(metaDir, result.renderedDomPath!)
    await expect(access(snapshotFullPath)).resolves.toBeUndefined()
    expect(snapshotFullPath.startsWith(siteDir)).toBe(false)
  })

  it('marks the result failed, not throwing, when the entry URL is SSRF-blocked', async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'capture-page-'))
    const siteDir = path.join(workDir, 'site')
    const metaDir = path.join(workDir, '_meta')
    const store = new ResourceStore(siteDir)

    const result = await capturePage({
      pageUrl: `${server.baseUrl}/`, // fixture server is on 127.0.0.1 — blocked by the real, default guard
      siteOrigin: server.baseUrl,
      siteDir,
      metaDir,
      store,
      browser,
      // no fetchDeps override — exercises the production default (SSRF-guarded) path
    })

    expect(result.status).toBe('failed')
    expect(result.warnings[0]).toMatch(/Blocked/)
  })
})
