import type { CaptureMode } from '../models/packaging.model.js'

/**
 * Structural parse of the optional `mode` field on a capture request body.
 * Defaults to `whole-site`; only an explicit `single-page` string switches
 * modes, so any malformed/unknown value degrades safely to the full crawl.
 */
export function parseCaptureMode(body: unknown): CaptureMode {
  if (typeof body !== 'object' || body === null) return 'whole-site'
  const mode = (body as Record<string, unknown>).mode
  return mode === 'single-page' ? 'single-page' : 'whole-site'
}
