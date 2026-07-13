import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { Agent } from 'undici'
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import type { SafeFetchTarget } from '../../capture/models/ssrf.model.js'
import { startFixtureServer } from '../../capture/testUtils/fixtureServer.js'
import { CAPTURE_REPORT_FILENAME, crawlSite } from './crawlSite.service.js'

const permissiveResolver = async (rawUrl: string): Promise<SafeFetchTarget> => ({
  url: new URL(rawUrl),
  dispatcher: new Agent(),
})

describe('crawlSite', () => {
  let browser: Browser
  let workDir: string

  beforeAll(async () => {
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser.close()
  })

  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true })
  })

  it('captures every page exactly once via sitemap + link discovery, and writes a matching capture-report.json', async () => {
    const server = await startFixtureServer({
      '/': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        // Absolute href on purpose: proves repair rewrites it to a
        // root-relative path rather than merely leaving an already-relative
        // href unchanged.
        res.end(`<html><body><a href="${server.baseUrl}/about">About</a><a href="/contact">Contact</a></body></html>`)
      },
      '/about': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body><a href="/">Home</a><a href="/contact">Contact</a></body></html>')
      },
      '/contact': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body><a href="/">Home</a></body></html>')
      },
      '/blog/hello': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>Standalone CMS page, not linked from anywhere</body></html>')
      },
      '/sitemap.xml': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/xml' })
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
          <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>${server.baseUrl}/</loc></url>
            <url><loc>${server.baseUrl}/about</loc></url>
            <url><loc>${server.baseUrl}/contact</loc></url>
            <url><loc>${server.baseUrl}/blog/hello</loc></url>
          </urlset>`)
      },
    })

    try {
      workDir = await mkdtemp(path.join(tmpdir(), 'crawl-site-'))
      const siteDir = path.join(workDir, 'site')
      const metaDir = path.join(workDir, '_meta')
      const progressCalls: Array<{ captured: number; total: number }> = []

      const report = await crawlSite({
        entryUrl: `${server.baseUrl}/`,
        siteDir,
        metaDir,
        browser,
        fetchDeps: { resolveTarget: permissiveResolver },
        onProgress: (p) => progressCalls.push(p),
      })

      expect(report.status).toBe('complete')
      expect(report.pages).toHaveLength(4)
      expect(report.pages.every((p) => p.status === 'captured')).toBe(true)

      const urls = report.pages.map((p) => p.url).sort()
      expect(urls).toEqual(
        [`${server.baseUrl}/`, `${server.baseUrl}/about`, `${server.baseUrl}/contact`, `${server.baseUrl}/blog/hello`].sort(),
      )

      expect(progressCalls.length).toBeGreaterThan(0)
      expect(progressCalls.at(-1)?.captured).toBe(4)

      const reportOnDisk = JSON.parse(await readFile(path.join(siteDir, CAPTURE_REPORT_FILENAME), 'utf-8'))
      expect(reportOnDisk).toEqual(report)

      // Phase 4 repair pass: bundled locally, and the home page's internal
      // links rewritten to root-relative paths rather than the live origin.
      const serveScript = await readFile(path.join(siteDir, 'serve.cjs'), 'utf-8')
      expect(serveScript).toContain('http.createServer')
      const homeHtml = await readFile(path.join(siteDir, 'index.html'), 'utf-8')
      expect(homeHtml).toContain('href="/about"')
      expect(homeHtml).toContain('href="/contact"')
      expect(homeHtml).not.toContain(server.baseUrl)
    } finally {
      await server.close()
    }
  })

  it('degrades gracefully and still writes a report when the repair pass throws', async () => {
    const server = await startFixtureServer({
      '/': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>home</body></html>')
      },
    })

    try {
      workDir = await mkdtemp(path.join(tmpdir(), 'crawl-site-'))
      const siteDir = path.join(workDir, 'site')
      const metaDir = path.join(workDir, '_meta')

      vi.doMock('../../repair/services/repairWorkspace.service.js', () => ({
        repairWorkspace: vi.fn(async () => {
          throw new Error('repair boom')
        }),
      }))
      vi.resetModules()
      const { crawlSite: crawlSiteWithFailingRepair } = await import('./crawlSite.service.js')

      const report = await crawlSiteWithFailingRepair({
        entryUrl: `${server.baseUrl}/`,
        siteDir,
        metaDir,
        browser,
        fetchDeps: { resolveTarget: permissiveResolver },
      })

      expect(report.status).toBe('complete')
      expect(report.pages).toHaveLength(1)
      expect(report.pages[0]?.status).toBe('captured')

      const reportOnDisk = JSON.parse(await readFile(path.join(siteDir, CAPTURE_REPORT_FILENAME), 'utf-8'))
      expect(reportOnDisk).toEqual(report)
    } finally {
      await server.close()
      vi.doUnmock('../../repair/services/repairWorkspace.service.js')
      vi.resetModules()
    }
  })

  it('degrades to partial and skips remaining pages once the workspace size cap is reached', async () => {
    const server = await startFixtureServer({
      '/': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body><img src="/img1.png"></body></html>')
      },
      '/page2': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body><img src="/img2.png"></body></html>')
      },
      '/page3': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body><img src="/img3.png"></body></html>')
      },
      '/img1.png': (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.alloc(50, 1))
      },
      '/img2.png': (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.alloc(50, 2))
      },
      '/img3.png': (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.alloc(50, 3))
      },
      '/sitemap.xml': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/xml' })
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
          <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>${server.baseUrl}/</loc></url>
            <url><loc>${server.baseUrl}/page2</loc></url>
            <url><loc>${server.baseUrl}/page3</loc></url>
          </urlset>`)
      },
    })

    try {
      workDir = await mkdtemp(path.join(tmpdir(), 'crawl-site-'))
      const siteDir = path.join(workDir, 'site')
      const metaDir = path.join(workDir, '_meta')

      const report = await crawlSite({
        entryUrl: `${server.baseUrl}/`,
        siteDir,
        metaDir,
        browser,
        concurrency: 1, // deterministic ordering: '/' then '/page2' then '/page3'
        maxWorkspaceBytes: 10, // smaller than any single 50-byte image
        fetchDeps: { resolveTarget: permissiveResolver },
      })

      expect(report.status).toBe('partial')
      expect(report.trippedWorkspaceCap).toBe(true)
      expect(report.trippedWallClock).toBe(false)

      const byUrl = new Map(report.pages.map((p) => [p.url, p]))
      expect(byUrl.get(`${server.baseUrl}/`)?.status).toBe('captured')
      expect(byUrl.get(`${server.baseUrl}/page2`)?.status).toBe('skipped-budget')
      expect(byUrl.get(`${server.baseUrl}/page3`)?.status).toBe('skipped-budget')
      expect(report.totalBytesCaptured).toBe(50)
    } finally {
      await server.close()
    }
  })

  it('degrades to partial and drops unstarted queued pages once the wall-clock timeout trips', async () => {
    const server = await startFixtureServer({
      '/slow': (_req, res) => {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end('<html><body>slow page</body></html>')
        }, 2000)
      },
      '/fast-1': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>fast 1</body></html>')
      },
      '/fast-2': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>fast 2</body></html>')
      },
      '/sitemap.xml': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/xml' })
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
          <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>${server.baseUrl}/slow</loc></url>
            <url><loc>${server.baseUrl}/fast-1</loc></url>
            <url><loc>${server.baseUrl}/fast-2</loc></url>
          </urlset>`)
      },
    })

    try {
      workDir = await mkdtemp(path.join(tmpdir(), 'crawl-site-'))
      const siteDir = path.join(workDir, 'site')
      const metaDir = path.join(workDir, '_meta')

      const report = await crawlSite({
        entryUrl: `${server.baseUrl}/slow`,
        siteDir,
        metaDir,
        browser,
        concurrency: 1, // only the entry ('/slow') is in flight when the timer trips
        wallClockTimeoutMs: 300,
        fetchDeps: { resolveTarget: permissiveResolver },
      })

      expect(report.status).toBe('partial')
      expect(report.trippedWallClock).toBe(true)
      expect(report.pagesDroppedByTimeout).toBeGreaterThan(0)
      // The in-flight page at trip time still finishes and gets recorded.
      expect(report.pages.some((p) => p.url === `${server.baseUrl}/slow` && p.status === 'captured')).toBe(true)
      expect(report.pages.length).toBeLessThan(3)
    } finally {
      await server.close()
    }
  })

  it('does not deadlock when sitemap discovery alone takes longer than the wall-clock timeout', async () => {
    const server = await startFixtureServer({
      '/': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>home</body></html>')
      },
      '/sitemap.xml': (_req, res) => {
        // Slower than wallClockTimeoutMs below — the timer fires while the
        // queue is still empty, before this ever resolves.
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/xml' })
          res.end(`<?xml version="1.0" encoding="UTF-8"?>
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>${server.baseUrl}/</loc></url>
            </urlset>`)
        }, 2000)
      },
    })

    try {
      workDir = await mkdtemp(path.join(tmpdir(), 'crawl-site-'))
      const siteDir = path.join(workDir, 'site')
      const metaDir = path.join(workDir, '_meta')

      const report = await crawlSite({
        entryUrl: `${server.baseUrl}/`,
        siteDir,
        metaDir,
        browser,
        wallClockTimeoutMs: 300,
        fetchDeps: { resolveTarget: permissiveResolver },
      })

      expect(report.status).toBe('partial')
      expect(report.trippedWallClock).toBe(true)
      // The timer fired before the entry URL (which was waiting on the slow
      // sitemap fetch to resolve first) was ever enqueued.
      expect(report.pages).toHaveLength(0)

      const reportOnDisk = JSON.parse(await readFile(path.join(siteDir, CAPTURE_REPORT_FILENAME), 'utf-8'))
      expect(reportOnDisk).toEqual(report)
    } finally {
      await server.close()
    }
  }, 10_000)

  it('still writes a report when every page fails (target fully down)', async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'crawl-site-'))
    const siteDir = path.join(workDir, 'site')
    const metaDir = path.join(workDir, '_meta')

    const report = await crawlSite({
      entryUrl: 'http://127.0.0.1:1/', // nothing listens here — connection refused
      siteDir,
      metaDir,
      browser,
      fetchDeps: {
        resolveTarget: async () => {
          throw new Error('connection refused')
        },
      },
    })

    expect(report.pages).toHaveLength(1)
    expect(report.pages[0]?.status).toBe('failed')

    const reportOnDisk = JSON.parse(await readFile(path.join(siteDir, CAPTURE_REPORT_FILENAME), 'utf-8'))
    expect(reportOnDisk).toEqual(report)
  })

  it('does not crash or drop the page report when a caller-supplied onProgress callback throws', async () => {
    const server = await startFixtureServer({
      '/': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>home</body></html>')
      },
    })

    try {
      workDir = await mkdtemp(path.join(tmpdir(), 'crawl-site-'))
      const siteDir = path.join(workDir, 'site')
      const metaDir = path.join(workDir, '_meta')

      const report = await crawlSite({
        entryUrl: `${server.baseUrl}/`,
        siteDir,
        metaDir,
        browser,
        fetchDeps: { resolveTarget: permissiveResolver },
        onProgress: () => {
          throw new Error('boom from a misbehaving caller callback')
        },
      })

      expect(report.status).toBe('complete')
      expect(report.pages).toHaveLength(1)
      expect(report.pages[0]?.status).toBe('captured')
    } finally {
      await server.close()
    }
  })
})
