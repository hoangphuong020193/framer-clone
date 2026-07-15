import fs from 'node:fs/promises'
import type { RegisterWorkspaceInput, WorkspaceRecord, WorkspaceRegistry } from '../models/packaging.model.js'

/**
 * In-memory registry of retained capture workspaces. One instance per server
 * process (created once in `index.ts`) — each registered workspace is
 * auto-deleted from disk once its TTL elapses, so a short-lived Tier 2 reuse
 * window never turns into permanently orphaned temp directories.
 */
export function createWorkspaceRegistry(): WorkspaceRegistry {
  const records = new Map<string, WorkspaceRecord>()
  const timers = new Map<string, NodeJS.Timeout>()

  async function cleanupNow(captureId: string): Promise<void> {
    const record = records.get(captureId)
    if (!record) return

    records.delete(captureId)
    const timer = timers.get(captureId)
    if (timer) {
      clearTimeout(timer)
      timers.delete(captureId)
    }

    await fs.rm(record.siteDir, { recursive: true, force: true })
    await fs.rm(record.metaDir, { recursive: true, force: true })
  }

  function register(input: RegisterWorkspaceInput): WorkspaceRecord {
    const record: WorkspaceRecord = {
      captureId: input.captureId,
      siteDir: input.siteDir,
      metaDir: input.metaDir,
      expiresAt: Date.now() + input.ttlMs,
    }
    records.set(input.captureId, record)

    const timer = setTimeout(() => {
      void cleanupNow(input.captureId)
    }, input.ttlMs)
    timer.unref()
    timers.set(input.captureId, timer)

    return record
  }

  function get(captureId: string): WorkspaceRecord | undefined {
    return records.get(captureId)
  }

  return { register, get, cleanupNow }
}
