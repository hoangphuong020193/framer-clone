import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { crawlSite } from '../../crawl/services/crawlSite.service.js'
import { DEFAULT_WORKSPACE_TTL_MS } from '../models/packaging.model.js'
import type { CaptureJobDeps, CaptureJobResult } from '../models/packaging.model.js'

/**
 * Runs a whole-site capture (Phase 2-4 pipeline) into a fresh workspace
 * directory, then retains it in `registry` for `workspaceTtlMs` (optional
 * Tier 2 reuse) instead of deleting it right away. If the crawl itself throws
 * (bad entry URL, infra failure — as opposed to a per-page capture failure,
 * which `crawlSite` already records in its report rather than throwing), the
 * partial workspace directory is removed immediately: nothing is retained for
 * a job that never produced a usable capture.
 */
export async function runCaptureJob(entryUrl: string, deps: CaptureJobDeps): Promise<CaptureJobResult> {
  const { browser, workspaceRoot, registry, workspaceTtlMs = DEFAULT_WORKSPACE_TTL_MS, fetchDeps } = deps

  const captureId = crypto.randomUUID()
  const jobDir = path.join(workspaceRoot, captureId)
  const siteDir = path.join(jobDir, 'site')
  const metaDir = path.join(jobDir, 'meta')

  try {
    const report = await crawlSite({ entryUrl, siteDir, metaDir, browser, fetchDeps })
    const record = registry.register({ captureId, siteDir, metaDir, ttlMs: workspaceTtlMs })
    return { captureId, siteDir, metaDir, report, expiresAt: record.expiresAt }
  } catch (error: unknown) {
    await fs.rm(jobDir, { recursive: true, force: true })
    throw error
  }
}
