import type { Browser } from 'playwright'
import type { FetchDeps } from '../../capture/models/fetchResource.model.js'
import type { CaptureMode, CrawlProgress, CrawlReport } from '../../crawl/models/crawl.model.js'

export type { CaptureMode } from '../../crawl/models/crawl.model.js'

export const DEFAULT_WORKSPACE_TTL_MS = 15 * 60 * 1000 // 15 minutes

export interface WorkspaceRecord {
  captureId: string
  siteDir: string
  metaDir: string
  entryUrl: string
  expiresAt: number
}

export interface RegisterWorkspaceInput {
  captureId: string
  siteDir: string
  metaDir: string
  entryUrl: string
  ttlMs: number
}

/**
 * Tracks capture workspaces retained on disk for a short TTL after a
 * successful crawl (so Tier 2 can reuse the same capture without re-crawling),
 * auto-deleting each one once its TTL elapses.
 */
export interface WorkspaceRegistry {
  register(input: RegisterWorkspaceInput): WorkspaceRecord
  get(captureId: string): WorkspaceRecord | undefined
  cleanupNow(captureId: string): Promise<void>
}

/** Per-request inputs for a single capture job (distinct from its injected deps). */
export interface CaptureJobInput {
  entryUrl: string
  captureId: string
  mode: CaptureMode
}

export interface CaptureJobResult {
  captureId: string
  siteDir: string
  metaDir: string
  report: CrawlReport
  expiresAt: number
}

export interface CaptureJobDeps {
  browser: Browser
  workspaceRoot: string
  registry: WorkspaceRegistry
  workspaceTtlMs?: number
  /** Forwarded to the crawl so the job manager can stream live progress. */
  onProgress?: (progress: CrawlProgress) => void
  /** Override point for tests only — production always uses the real SSRF-guarded resolver. */
  fetchDeps?: FetchDeps
}

