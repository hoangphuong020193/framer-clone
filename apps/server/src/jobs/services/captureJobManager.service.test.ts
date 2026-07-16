import type { Browser } from 'playwright'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceRegistry } from '../../packaging/models/packaging.model.js'
import type { CaptureJobEvent, CaptureJobManager, CaptureJobManagerDeps } from '../models/captureJobManager.model.js'

const { runCaptureJobMock } = vi.hoisted(() => ({ runCaptureJobMock: vi.fn() }))
vi.mock('../../packaging/services/captureJob.service.js', () => ({ runCaptureJob: runCaptureJobMock }))

const { createCaptureJobManager } = await import('./captureJobManager.service.js')

const registry: WorkspaceRegistry = {
  register: () => ({ captureId: 'x', siteDir: 's', metaDir: 'm', expiresAt: 0 }),
  get: () => undefined,
  cleanupNow: async () => {},
}

function makeDeps(): CaptureJobManagerDeps {
  return { getBrowser: async () => ({}) as unknown as Browser, workspaceRoot: '/tmp/ws', registry }
}

function collectUntilTerminal(manager: CaptureJobManager, captureId: string): Promise<CaptureJobEvent[]> {
  return new Promise((resolve) => {
    const events: CaptureJobEvent[] = []
    manager.subscribe(captureId, (event) => {
      events.push(event)
      if (event.type !== 'progress') resolve(events)
    })
  })
}

describe('createCaptureJobManager', () => {
  beforeEach(() => {
    runCaptureJobMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('streams progress then a done event carrying the final report and expiry', async () => {
    runCaptureJobMock.mockImplementation(async (input, deps) => {
      deps.onProgress?.({ captured: 1, total: 2 })
      deps.onProgress?.({ captured: 2, total: 2 })
      return {
        captureId: input.captureId,
        siteDir: 's',
        metaDir: 'm',
        report: { status: 'complete', pages: [{}, {}], totalPagesDiscovered: 2 },
        expiresAt: 4242,
      }
    })
    const manager = createCaptureJobManager(makeDeps())
    const snap = manager.start({ entryUrl: 'https://example.com', mode: 'whole-site' })
    const events = await collectUntilTerminal(manager, snap.captureId)

    const done = events[events.length - 1]
    expect(done.type).toBe('done')
    expect(done.snapshot.status).toBe('complete')
    expect(done.snapshot.expiresAt).toBe(4242)
    expect(done.snapshot.progress).toEqual({ captured: 2, total: 2 })
    expect(events.some((e) => e.type === 'progress' && e.snapshot.progress.captured === 1)).toBe(true)
  })

  it('maps a partial crawl report to a partial job status', async () => {
    runCaptureJobMock.mockResolvedValue({
      captureId: 'x',
      siteDir: 's',
      metaDir: 'm',
      report: { status: 'partial', pages: [{}], totalPagesDiscovered: 5 },
      expiresAt: 1,
    })
    const manager = createCaptureJobManager(makeDeps())
    const snap = manager.start({ entryUrl: 'https://example.com', mode: 'whole-site' })
    const events = await collectUntilTerminal(manager, snap.captureId)
    expect(events[events.length - 1].snapshot.status).toBe('partial')
  })

  it('emits a generic error with no internal detail when the job throws', async () => {
    runCaptureJobMock.mockRejectedValue(new Error('secret internal detail'))
    const manager = createCaptureJobManager(makeDeps())
    const snap = manager.start({ entryUrl: 'https://example.com', mode: 'whole-site' })
    const events = await collectUntilTerminal(manager, snap.captureId)

    const terminal = events[events.length - 1]
    expect(terminal.type).toBe('failed')
    expect(terminal.snapshot.status).toBe('failed')
    expect(terminal.snapshot.error).toBe('Capture failed, please try again')
    expect(JSON.stringify(terminal.snapshot)).not.toContain('secret internal detail')
  })

  it('forwards the requested capture mode to the job', async () => {
    runCaptureJobMock.mockResolvedValue({
      captureId: 'x',
      siteDir: 's',
      metaDir: 'm',
      report: { status: 'complete', pages: [], totalPagesDiscovered: 0 },
      expiresAt: 0,
    })
    const manager = createCaptureJobManager(makeDeps())
    const snap = manager.start({ entryUrl: 'https://example.com', mode: 'single-page' })
    await collectUntilTerminal(manager, snap.captureId)
    expect(runCaptureJobMock.mock.calls[0][0]).toMatchObject({ mode: 'single-page', entryUrl: 'https://example.com' })
  })

  it('replays a terminal event to a subscriber that connects after completion', async () => {
    runCaptureJobMock.mockResolvedValue({
      captureId: 'x',
      siteDir: 's',
      metaDir: 'm',
      report: { status: 'complete', pages: [], totalPagesDiscovered: 0 },
      expiresAt: 0,
    })
    const manager = createCaptureJobManager(makeDeps())
    const snap = manager.start({ entryUrl: 'https://example.com', mode: 'whole-site' })
    await collectUntilTerminal(manager, snap.captureId)

    const late = await collectUntilTerminal(manager, snap.captureId)
    expect(late).toHaveLength(1)
    expect(late[0].type).toBe('done')
  })

  it('returns undefined snapshot for an unknown capture id', () => {
    const manager = createCaptureJobManager(makeDeps())
    expect(manager.getSnapshot('missing')).toBeUndefined()
  })
})
