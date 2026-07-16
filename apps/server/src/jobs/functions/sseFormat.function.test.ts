import { describe, expect, it } from 'vitest'
import type { CaptureJobSnapshot } from '../models/captureJobManager.model.js'
import { formatSseEvent } from './sseFormat.function.js'

const snapshot: CaptureJobSnapshot = {
  captureId: 'cap-1',
  mode: 'whole-site',
  status: 'running',
  progress: { captured: 1, total: 3 },
  report: null,
  error: null,
  expiresAt: null,
}

describe('formatSseEvent', () => {
  it('emits a named event line, a single JSON data line, and a trailing blank line', () => {
    const frame = formatSseEvent({ type: 'progress', snapshot })

    expect(frame).toBe(`event: progress\ndata: ${JSON.stringify(snapshot)}\n\n`)
    expect(frame.endsWith('\n\n')).toBe(true)
  })

  it('uses the event type as the SSE event name for terminal events', () => {
    expect(formatSseEvent({ type: 'done', snapshot }).startsWith('event: done\n')).toBe(true)
    expect(formatSseEvent({ type: 'failed', snapshot }).startsWith('event: failed\n')).toBe(true)
  })

  it('keeps the JSON payload on one line (no raw newlines to break the frame)', () => {
    const dataLine = formatSseEvent({ type: 'progress', snapshot }).split('\n')[1]
    expect(dataLine.startsWith('data: ')).toBe(true)
    expect(dataLine.includes('\n')).toBe(false)
  })
})
