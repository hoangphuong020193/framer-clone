import type { Browser } from 'playwright'
import type { FetchDeps } from '../../capture/models/fetchResource.model.js'

/**
 * `single-page` captures only the entry URL (no sitemap seeding, no
 * link-following) — the fast common case for a single landing page.
 * `whole-site` does the full sitemap + BFS crawl.
 */
export type CaptureMode = 'single-page' | 'whole-site'

export interface CrawlPageReportEntry {
  url: string
  status: 'captured' | 'degraded' | 'failed' | 'skipped-budget'
  localHtmlPath: string | null
  resourceCount: number
  bytesCaptured: number
  warnings: string[]
}

export interface CrawlReport {
  status: 'complete' | 'partial'
  startedAt: string
  finishedAt: string
  entryUrl: string
  totalPagesDiscovered: number
  totalBytesCaptured: number
  workspaceCapBytes: number
  wallClockTimeoutMs: number
  trippedWallClock: boolean
  trippedWorkspaceCap: boolean
  pagesDroppedByTimeout: number
  pages: CrawlPageReportEntry[]
}

export interface CrawlProgress {
  captured: number
  total: number
}

export interface WallClockQueue {
  /** True once the wall-clock timeout has fired. */
  isTripped: () => boolean
  /** Number of not-yet-started tasks dropped when the timeout fired. */
  pagesDroppedByTimeout: () => number
  add: (task: () => Promise<void>) => Promise<void>
  onIdle: () => Promise<void>
  /** Cancels the deadline timer; call once the crawl finishes normally. */
  stop: () => void
}

export interface WorkspaceReservation {
  reserved: boolean
  estimateBytes: number
}

export interface SitemapCrawlState {
  found: Set<string>
  visited: Set<string>
  fetchCount: number
}

export interface CrawlSiteOptions {
  entryUrl: string
  /** Becomes the zip contents (Phase 5) — only ever written to via `ResourceStore`. */
  siteDir: string
  /** Sibling of siteDir, never bundled into the archive (rendered-DOM snapshots). */
  metaDir: string
  browser: Browser
  /** Defaults to `whole-site`. `single-page` skips sitemap seeding + link-following. */
  mode?: CaptureMode
  concurrency?: number
  maxWorkspaceBytes?: number
  wallClockTimeoutMs?: number
  onProgress?: (progress: CrawlProgress) => void
  fetchDeps?: FetchDeps
}
