import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { Agent } from 'undici'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SafeFetchTarget } from '../../capture/models/ssrf.model.js'
import { startFixtureServer } from '../../capture/testUtils/fixtureServer.js'
import { createWorkspaceRegistry } from './workspaceRegistry.service.js'
import { runCaptureJob } from './captureJob.service.js'

const permissiveResolver = async (rawUrl: string): Promise<SafeFetchTarget> => ({
  url: new URL(rawUrl),
  dispatcher: new Agent(),
})

describe('runCaptureJob', () => {
  let browser: Browser
  let workspaceRoot: string

  beforeAll(async () => {
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser.close()
  })

  afterEach(async () => {
    if (workspaceRoot) await fs.rm(workspaceRoot, { recursive: true, force: true })
  })

  it('captures a site into a fresh workspace and retains it in the registry', async () => {
    const server = await startFixtureServer({
      '/': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>home</body></html>')
      },
    })

    try {
      workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), 'capture-job-'))
      const registry = createWorkspaceRegistry()

      const result = await runCaptureJob(
        { entryUrl: `${server.baseUrl}/`, captureId: crypto.randomUUID(), mode: 'whole-site' },
        { browser, workspaceRoot, registry, fetchDeps: { resolveTarget: permissiveResolver } },
      )

      expect(result.report.status).toBe('complete')
      expect(result.report.pages[0]?.status).toBe('captured')
      expect(await fs.readFile(path.join(result.siteDir, 'index.html'), 'utf-8')).toContain('home')
      expect(registry.get(result.captureId)).toMatchObject({ siteDir: result.siteDir, metaDir: result.metaDir })
    } finally {
      await server.close()
    }
  })

  it('cleans up the partial workspace directory and does not register anything when the crawl throws', async () => {
    workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), 'capture-job-'))
    const registry = createWorkspaceRegistry()

    await expect(
      runCaptureJob({ entryUrl: 'not a url', captureId: crypto.randomUUID(), mode: 'whole-site' }, { browser, workspaceRoot, registry }),
    ).rejects.toThrow()

    const leftoverEntries = await fs.readdir(workspaceRoot)
    expect(leftoverEntries).toHaveLength(0)
  })

  it('respects a custom workspaceTtlMs when registering the workspace', async () => {
    const server = await startFixtureServer({
      '/': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>home</body></html>')
      },
    })

    try {
      workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), 'capture-job-'))
      const registry = createWorkspaceRegistry()
      const before = Date.now()

      const result = await runCaptureJob(
        { entryUrl: `${server.baseUrl}/`, captureId: crypto.randomUUID(), mode: 'whole-site' },
        { browser, workspaceRoot, registry, workspaceTtlMs: 1000, fetchDeps: { resolveTarget: permissiveResolver } },
      )

      expect(result.expiresAt).toBeGreaterThanOrEqual(before + 1000)
      expect(result.expiresAt).toBeLessThan(before + 60_000)
    } finally {
      await server.close()
    }
  })

  it('runs two concurrent capture jobs against the same shared browser and registry independently', async () => {
    const server = await startFixtureServer({
      '/': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>home</body></html>')
      },
    })

    try {
      workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), 'capture-job-'))
      const registry = createWorkspaceRegistry()

      const [first, second] = await Promise.all([
        runCaptureJob(
          { entryUrl: `${server.baseUrl}/`, captureId: crypto.randomUUID(), mode: 'whole-site' },
          { browser, workspaceRoot, registry, fetchDeps: { resolveTarget: permissiveResolver } },
        ),
        runCaptureJob(
          { entryUrl: `${server.baseUrl}/`, captureId: crypto.randomUUID(), mode: 'single-page' },
          { browser, workspaceRoot, registry, fetchDeps: { resolveTarget: permissiveResolver } },
        ),
      ])

      expect(first.captureId).not.toBe(second.captureId)
      expect(first.siteDir).not.toBe(second.siteDir)
      expect(registry.get(first.captureId)).toBeDefined()
      expect(registry.get(second.captureId)).toBeDefined()
      expect(await fs.readFile(path.join(first.siteDir, 'index.html'), 'utf-8')).toContain('home')
      expect(await fs.readFile(path.join(second.siteDir, 'index.html'), 'utf-8')).toContain('home')
    } finally {
      await server.close()
    }
  })
})
