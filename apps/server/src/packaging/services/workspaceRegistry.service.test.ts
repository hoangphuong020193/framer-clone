import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkspaceRegistry } from './workspaceRegistry.service.js'

describe('createWorkspaceRegistry', () => {
  let tempDir: string
  let siteDir: string
  let metaDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-registry-'))
    siteDir = path.join(tempDir, 'site')
    metaDir = path.join(tempDir, 'meta')
    await fs.mkdir(siteDir, { recursive: true })
    await fs.mkdir(metaDir, { recursive: true })
    await fs.writeFile(path.join(siteDir, 'index.html'), '<html></html>')
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('registers a workspace and returns it via get()', () => {
    const registry = createWorkspaceRegistry()
    const record = registry.register({ captureId: 'abc', siteDir, metaDir, ttlMs: 60_000 })

    expect(registry.get('abc')).toEqual(record)
    expect(record.expiresAt).toBeGreaterThan(Date.now())
  })

  it('returns undefined for an unknown captureId', () => {
    const registry = createWorkspaceRegistry()
    expect(registry.get('missing')).toBeUndefined()
  })

  it('cleanupNow removes both directories and drops the record', async () => {
    const registry = createWorkspaceRegistry()
    registry.register({ captureId: 'abc', siteDir, metaDir, ttlMs: 60_000 })

    await registry.cleanupNow('abc')

    expect(registry.get('abc')).toBeUndefined()
    await expect(fs.access(siteDir)).rejects.toThrow()
    await expect(fs.access(metaDir)).rejects.toThrow()
  })

  it('cleanupNow is a no-op for an unknown captureId', async () => {
    const registry = createWorkspaceRegistry()
    await expect(registry.cleanupNow('missing')).resolves.toBeUndefined()
  })

  it('auto-cleans up the workspace once its TTL elapses', async () => {
    const registry = createWorkspaceRegistry()
    registry.register({ captureId: 'abc', siteDir, metaDir, ttlMs: 50 })

    // Poll the filesystem itself rather than registry.get() — the registry
    // drops its record synchronously at the start of cleanupNow, before the
    // async fs.rm() calls finish, so polling on the record alone can observe
    // "cleaned up" while deletion is still in flight and race afterEach's own
    // fs.rm(tempDir, ...) (a real Windows EPERM source). Poll rather than a
    // single fixed sleep — under parallel test-worker CPU contention a 50ms
    // timer can legitimately fire a bit late.
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      try {
        await fs.access(siteDir)
      } catch {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    await expect(fs.access(siteDir)).rejects.toThrow()
    expect(registry.get('abc')).toBeUndefined()
  }, 10_000)

  it('handles two concurrent cleanupNow calls for the same captureId without throwing', async () => {
    const registry = createWorkspaceRegistry()
    registry.register({ captureId: 'abc', siteDir, metaDir, ttlMs: 60_000 })

    await Promise.all([registry.cleanupNow('abc'), registry.cleanupNow('abc')])

    expect(registry.get('abc')).toBeUndefined()
    await expect(fs.access(siteDir)).rejects.toThrow()
  })

  it('does not let a manual cleanupNow race the TTL timer into a double-delete error', async () => {
    const registry = createWorkspaceRegistry()
    registry.register({ captureId: 'abc', siteDir, metaDir, ttlMs: 30 })

    await registry.cleanupNow('abc')
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(registry.get('abc')).toBeUndefined()
  })
})
