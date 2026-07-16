import type { CaptureJobEvent } from '../models/captureJobManager.model.js'

/**
 * Serializes a job event as a Server-Sent Events frame: a named `event:` line
 * plus a single `data:` line (JSON never contains a raw newline, so one data
 * line is always safe), terminated by the blank line that flushes the frame.
 */
export function formatSseEvent(event: CaptureJobEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.snapshot)}\n\n`
}
