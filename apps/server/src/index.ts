import express from 'express'
import os from 'node:os'
import path from 'node:path'
import { closeSharedBrowser, getSharedBrowser } from './browser/services/browserLifecycle.service.js'
import { createCaptureJobManager } from './jobs/services/captureJobManager.service.js'
import { createWorkspaceRegistry } from './packaging/services/workspaceRegistry.service.js'
import { createCaptureRoutes } from './routes/captureRoutes.js'
import { shutdownGracefully } from './server/services/gracefulShutdown.service.js'

const app = express()
const port = process.env.PORT ? Number(process.env.PORT) : 3001

const workspaceRoot = path.join(os.tmpdir(), 'framer-clone-captures')
const registry = createWorkspaceRegistry()
const manager = createCaptureJobManager({ getBrowser: getSharedBrowser, workspaceRoot, registry })

app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api', createCaptureRoutes({ manager, registry, workspaceRoot }))

const server = app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})

async function shutdown(): Promise<void> {
  await shutdownGracefully({ server, closeBrowser: closeSharedBrowser })
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown()
})
process.on('SIGTERM', () => {
  void shutdown()
})
