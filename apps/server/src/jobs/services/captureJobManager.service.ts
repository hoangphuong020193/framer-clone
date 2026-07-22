import crypto from 'node:crypto'
import type { CrawlReport } from '../../crawl/models/crawl.model.js'
import { DEFAULT_WORKSPACE_TTL_MS } from '../../packaging/models/packaging.model.js'
import { runCaptureJob } from '../../packaging/services/captureJob.service.js'
import type {
  CaptureJobEvent,
  CaptureJobListener,
  CaptureJobManager,
  CaptureJobManagerDeps,
  CaptureJobSnapshot,
  StartCaptureJobInput,
} from '../models/captureJobManager.model.js'

interface JobRecord {
  snapshot: CaptureJobSnapshot
  listeners: Set<CaptureJobListener>
}

const GENERIC_FAILURE_MESSAGE = 'Capture failed, please try again'

/** Pages that actually wrote a browsable HTML file (so preview/download work). */
function countUsablePages(report: CrawlReport): number {
  return report.pages.filter((page) => page.status === 'captured' || page.status === 'degraded').length
}

/**
 * Explains a run that finished but captured nothing browsable, surfacing the
 * entry page's own failure reason (safe to show — it describes the target site,
 * e.g. a navigation timeout — not server internals) so the result is actionable.
 */
function noCaptureMessage(report: CrawlReport): string {
  const entry = report.pages.find((page) => page.url === report.entryUrl) ?? report.pages[0]
  const reason = entry?.warnings.find((warning) => warning.trim() !== '')
  return reason ? `Could not capture the page — ${reason}` : 'No pages could be captured from this site.'
}

/**
 * In-memory registry of async capture jobs. `start` kicks a background crawl
 * and returns immediately; progress and the terminal result are fanned out to
 * SSE subscribers. A job's record is dropped one workspace-TTL after it settles
 * (the retained workspace is gone by then too), so nothing accumulates forever.
 */
export function createCaptureJobManager(deps: CaptureJobManagerDeps): CaptureJobManager {
  const { getBrowser, workspaceRoot, registry, workspaceTtlMs = DEFAULT_WORKSPACE_TTL_MS } = deps
  const jobs = new Map<string, JobRecord>()

  function emit(record: JobRecord, event: CaptureJobEvent): void {
    for (const listener of record.listeners) {
      try {
        listener(event)
      } catch {
        // A subscriber (e.g. a disconnected SSE response) must never break the job or its peers.
      }
    }
  }

  function update(record: JobRecord, patch: Partial<CaptureJobSnapshot>, type: CaptureJobEvent['type']): void {
    record.snapshot = { ...record.snapshot, ...patch }
    emit(record, { type, snapshot: record.snapshot })
  }

  async function runJob(captureId: string, record: JobRecord, input: StartCaptureJobInput): Promise<void> {
    try {
      const browser = await getBrowser()
      const result = await runCaptureJob(
        { entryUrl: input.entryUrl, captureId, mode: input.mode },
        {
          browser,
          workspaceRoot,
          registry,
          workspaceTtlMs,
          onProgress: (progress) => update(record, { progress }, 'progress'),
        },
      )
      const { report } = result
      const capturedCount = countUsablePages(report)
      const progress = { captured: capturedCount, total: report.totalPagesDiscovered }

      // A run can finish "complete" per the crawl's own guardrails yet still have
      // captured nothing browsable (every page failed). There is no page to
      // preview or archive, so surface it as a failure rather than a hollow success.
      if (capturedCount === 0) {
        update(record, { status: 'failed', report, progress, error: noCaptureMessage(report) }, 'failed')
        return
      }

      update(
        record,
        {
          status: report.status === 'partial' ? 'partial' : 'complete',
          report,
          progress,
          expiresAt: result.expiresAt,
        },
        'done',
      )
    } catch (error: unknown) {
      console.error(`Capture job ${captureId} failed:`, error)
      update(record, { status: 'failed', error: GENERIC_FAILURE_MESSAGE }, 'failed')
    } finally {
      const timer = setTimeout(() => jobs.delete(captureId), workspaceTtlMs)
      timer.unref()
    }
  }

  function start(input: StartCaptureJobInput): CaptureJobSnapshot {
    const captureId = crypto.randomUUID()
    const record: JobRecord = {
      snapshot: {
        captureId,
        mode: input.mode,
        status: 'running',
        progress: { captured: 0, total: 0 },
        report: null,
        error: null,
        expiresAt: null,
      },
      listeners: new Set(),
    }
    jobs.set(captureId, record)
    void runJob(captureId, record, input)
    return record.snapshot
  }

  function getSnapshot(captureId: string): CaptureJobSnapshot | undefined {
    return jobs.get(captureId)?.snapshot
  }

  function subscribe(captureId: string, listener: CaptureJobListener): () => void {
    const record = jobs.get(captureId)
    if (!record) return () => {}

    const { status } = record.snapshot
    const initialType: CaptureJobEvent['type'] = status === 'running' ? 'progress' : status === 'failed' ? 'failed' : 'done'
    // Replay current state synchronously so a subscriber that connects after the
    // job already settled still receives a terminal event (no missed completion).
    try {
      listener({ type: initialType, snapshot: record.snapshot })
    } catch {
      // ignore a throw from the replay listener
    }

    record.listeners.add(listener)
    return () => {
      record.listeners.delete(listener)
    }
  }

  return { start, getSnapshot, subscribe }
}
