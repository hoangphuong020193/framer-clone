import { Router } from 'express'
import { formatSseEvent } from '../jobs/functions/sseFormat.function.js'
import { parseCaptureMode } from '../packaging/functions/parseCaptureMode.function.js'
import { parseCaptureUrl } from '../packaging/functions/parseCaptureUrl.function.js'
import { readPreviewFile } from '../packaging/services/previewWorkspace.service.js'
import { streamWorkspaceZip } from '../packaging/services/zipWorkspace.service.js'
import type { CaptureRoutesDeps } from './captureRoutes.model.js'

export type { CaptureRoutesDeps } from './captureRoutes.model.js'

/**
 * Capture API. A job is started asynchronously (`POST /capture` → 202 with a
 * `captureId`); the client then streams progress over SSE, previews the
 * retained workspace read-only, and downloads a zip of it — all keyed by that
 * id. Deeper validation (same-origin, SSRF) happens inside the pipeline; the
 * handlers here stay thin, delegating to the manager and workspace services.
 */
export function createCaptureRoutes(deps: CaptureRoutesDeps): Router {
  const router = Router()

  router.post('/capture', (req, res) => {
    const parsedUrl = parseCaptureUrl(req.body)
    if (!parsedUrl) {
      res.status(400).json({ error: 'A valid http(s) url is required' })
      return
    }
    const snapshot = deps.manager.start({ entryUrl: parsedUrl.toString(), mode: parseCaptureMode(req.body) })
    res.status(202).json(snapshot)
  })

  router.get('/capture/:captureId/events', (req, res) => {
    const snapshot = deps.manager.getSnapshot(req.params.captureId)
    if (!snapshot) {
      res.status(404).json({ error: 'Unknown or expired capture' })
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // `subscribe` replays current state synchronously, so a job that already
    // settled ends the stream inside this call — hence the post-subscribe check.
    let settled = false
    const unsubscribe = deps.manager.subscribe(req.params.captureId, (event) => {
      res.write(formatSseEvent(event))
      if (event.type !== 'progress') {
        settled = true
        res.end()
      }
    })
    if (settled) unsubscribe()
    else req.on('close', unsubscribe)
  })

  router.get('/capture/:captureId/download', async (req, res) => {
    const record = deps.registry.get(req.params.captureId)
    if (!record) {
      res.status(404).json({ error: 'Capture not found or expired' })
      return
    }

    res.status(200)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="capture.zip"')
    try {
      await streamWorkspaceZip(record.siteDir, res)
    } catch (error: unknown) {
      console.error(`Zip streaming failed for capture ${req.params.captureId}:`, error)
      res.destroy(error instanceof Error ? error : new Error('zip streaming failed'))
    }
  })

  router.get('/capture/:captureId/preview/*', async (req, res) => {
    const record = deps.registry.get(req.params.captureId)
    if (!record) {
      res.status(404).send('Capture not found or expired')
      return
    }

    const wildcard = (req.params as Record<string, string | undefined>)[0] ?? ''
    const requestPath = `/${wildcard}`
    const previewBasePath = `${req.baseUrl}/capture/${req.params.captureId}/preview`
    const file = await readPreviewFile(record.siteDir, requestPath, previewBasePath)
    if (!file) {
      res.status(404).send('Not found')
      return
    }
    res.status(200).type(file.contentType).send(file.body)
  })

  return router
}
