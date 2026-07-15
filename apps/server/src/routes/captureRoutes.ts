import { Router } from 'express'
import { getSharedBrowser } from '../browser/services/browserLifecycle.service.js'
import type { CaptureRoutesDeps } from '../packaging/models/packaging.model.js'
import { parseCaptureUrl } from '../packaging/functions/parseCaptureUrl.function.js'
import { runCaptureJob } from '../packaging/services/captureJob.service.js'
import { streamWorkspaceZip } from '../packaging/services/zipWorkspace.service.js'

export type { CaptureRoutesDeps } from '../packaging/models/packaging.model.js'

/**
 * `POST /api/capture { url }` — runs the whole-site capture pipeline
 * synchronously and streams back a zip of the result. Deeper validation
 * (same-origin normalization, SSRF checks) happens inside the capture
 * pipeline itself; this only rejects structurally invalid input early.
 */
export function createCaptureRoutes(deps: CaptureRoutesDeps): Router {
  const router = Router()

  router.post('/capture', async (req, res) => {
    const parsedUrl = parseCaptureUrl(req.body)
    if (!parsedUrl) {
      res.status(400).json({ error: 'A valid http(s) url is required' })
      return
    }

    const entryUrl = parsedUrl.toString()
    let job
    try {
      const browser = await getSharedBrowser()
      job = await runCaptureJob(entryUrl, { browser, workspaceRoot: deps.workspaceRoot, registry: deps.registry })
    } catch (error: unknown) {
      console.error(`Capture failed for ${entryUrl}:`, error)
      res.status(500).json({ error: 'Capture failed, please try again' })
      return
    }

    res.status(200)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="capture.zip"')

    try {
      await streamWorkspaceZip(job.siteDir, res)
    } catch (error: unknown) {
      console.error(`Zip streaming failed for capture ${job.captureId}:`, error)
      res.destroy(error instanceof Error ? error : new Error('zip streaming failed'))
    }
  })

  return router
}
