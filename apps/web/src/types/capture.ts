export type CaptureMode = 'single-page' | 'whole-site'

export type CaptureStatus = 'running' | 'complete' | 'partial' | 'failed'

export interface CaptureProgress {
  captured: number
  total: number
}

export interface CapturePageSummary {
  url: string
  status: string
}

/** The subset of the server's crawl report the UI renders. */
export interface CaptureReportSummary {
  status: 'complete' | 'partial'
  totalPagesDiscovered: number
  pagesDroppedByTimeout: number
  trippedWallClock: boolean
  trippedWorkspaceCap: boolean
  pages: CapturePageSummary[]
}

/** Mirror of the server's `CaptureJobSnapshot`, sent on `POST /api/capture` and every SSE frame. */
export interface CaptureSnapshot {
  captureId: string
  mode: CaptureMode
  status: CaptureStatus
  progress: CaptureProgress
  report: CaptureReportSummary | null
  error: string | null
  expiresAt: number | null
}

/** Client-side lifecycle of a capture, derived from server snapshots. */
export type CapturePhase = 'idle' | 'starting' | 'running' | 'succeeded' | 'partial' | 'failed'
