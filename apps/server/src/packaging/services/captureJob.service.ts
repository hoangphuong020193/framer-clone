import fs from 'node:fs/promises'
import path from 'node:path'
import { crawlSite } from '../../crawl/services/crawlSite.service.js'
import { DEFAULT_WORKSPACE_TTL_MS } from '../models/packaging.model.js'
import type { CaptureJobDeps, CaptureJobInput, CaptureJobResult } from '../models/packaging.model.js'

/**
 * Runs a capture (Phase 2-4 pipeline) into a fresh workspace directory, then
 * retains it in `registry` for `workspaceTtlMs` (optional Tier 2 reuse) instead
 * of deleting it right away. If the crawl itself throws (bad entry URL, infra
 * failure — as opposed to a per-page capture failure, which `crawlSite` already
 * records in its report rather than throwing), the partial workspace directory
 * is removed immediately: nothing is retained for a job that never produced a
 * usable capture. `captureId` is supplied by the caller so an async job manager
 * can hand it to the client (for SSE/download/preview) before the crawl starts.
 */
export async function runCaptureJob(input: CaptureJobInput, deps: CaptureJobDeps): Promise<CaptureJobResult> {
  const { entryUrl, captureId, mode } = input
  const { browser, workspaceRoot, registry, workspaceTtlMs = DEFAULT_WORKSPACE_TTL_MS, onProgress, fetchDeps } = deps

  const jobDir = path.join(workspaceRoot, captureId)
  const siteDir = path.join(jobDir, 'site')
  const metaDir = path.join(jobDir, 'meta')

  try {
    const report = await crawlSite({ entryUrl, siteDir, metaDir, browser, mode, onProgress, fetchDeps })
    const record = registry.register({ captureId, siteDir, metaDir, ttlMs: workspaceTtlMs })
    return { captureId, siteDir, metaDir, report, expiresAt: record.expiresAt }
  } catch (error: unknown) {
    await fs.rm(jobDir, { recursive: true, force: true })
    throw error
  }
}
