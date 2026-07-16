import type { Browser } from 'playwright'
import type { CaptureMode, CrawlProgress, CrawlReport } from '../../crawl/models/crawl.model.js'
import type { WorkspaceRegistry } from '../../packaging/models/packaging.model.js'

export type { CaptureMode, CrawlProgress } from '../../crawl/models/crawl.model.js'

/** `running` until the crawl settles; `complete`/`partial` mirror the crawl report; `failed` on a thrown job. */
export type CaptureJobStatus = 'running' | 'complete' | 'partial' | 'failed'

export interface CaptureJobSnapshot {
  captureId: string
  mode: CaptureMode
  status: CaptureJobStatus
  progress: CrawlProgress
  /** Set once the crawl settles (`complete`/`partial`); null while running or on failure. */
  report: CrawlReport | null
  /** Client-safe message; only set when status is `failed`. Server logs hold the detail. */
  error: string | null
  /** Workspace TTL expiry (ms epoch); set on success, null while running or on failure. */
  expiresAt: number | null
}

export type CaptureJobEvent =
  | { type: 'progress'; snapshot: CaptureJobSnapshot }
  | { type: 'done'; snapshot: CaptureJobSnapshot }
  | { type: 'failed'; snapshot: CaptureJobSnapshot }

export type CaptureJobListener = (event: CaptureJobEvent) => void

export interface StartCaptureJobInput {
  entryUrl: string
  mode: CaptureMode
}

/**
 * Owns capture jobs run asynchronously: `start` kicks a job off and returns its
 * initial snapshot immediately (with the `captureId` the client uses for
 * SSE/download/preview), while the crawl proceeds in the background.
 */
export interface CaptureJobManager {
  start(input: StartCaptureJobInput): CaptureJobSnapshot
  getSnapshot(captureId: string): CaptureJobSnapshot | undefined
  /**
   * Registers `listener`, immediately replaying the job's current state as one
   * event (a terminal event if the job already settled), then streaming each
   * subsequent transition. Returns an unsubscribe function.
   */
  subscribe(captureId: string, listener: CaptureJobListener): () => void
}

export interface CaptureJobManagerDeps {
  getBrowser: () => Promise<Browser>
  workspaceRoot: string
  registry: WorkspaceRegistry
  workspaceTtlMs?: number
}
