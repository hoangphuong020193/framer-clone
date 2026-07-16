import crypto from 'node:crypto'
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
      update(
        record,
        {
          status: result.report.status === 'partial' ? 'partial' : 'complete',
          report: result.report,
          progress: { captured: result.report.pages.length, total: result.report.totalPagesDiscovered },
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
