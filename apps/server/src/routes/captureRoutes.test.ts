import express from 'express'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  CaptureJobListener,
  CaptureJobManager,
  CaptureJobSnapshot,
  StartCaptureJobInput,
} from '../jobs/models/captureJobManager.model.js'
import { createWorkspaceRegistry } from '../packaging/services/workspaceRegistry.service.js'
import { createCaptureRoutes } from './captureRoutes.js'

const ZIP_LOCAL_FILE_HEADER_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const CAPTURE_ID = 'cap-1'

function runningSnapshot(mode: StartCaptureJobInput['mode']): CaptureJobSnapshot {
  return { captureId: CAPTURE_ID, mode, status: 'running', progress: { captured: 0, total: 0 }, report: null, error: null, expiresAt: null }
}

/** Minimal in-memory manager stub; `terminal` drives what `subscribe` replays. */
function fakeManager(terminal?: CaptureJobSnapshot): CaptureJobManager {
  let started: CaptureJobSnapshot | undefined
  return {
    start(input: StartCaptureJobInput): CaptureJobSnapshot {
      started = runningSnapshot(input.mode)
      return started
    },
    getSnapshot(captureId: string): CaptureJobSnapshot | undefined {
      if (captureId !== CAPTURE_ID) return undefined
      return terminal ?? started ?? runningSnapshot('whole-site')
    },
    subscribe(captureId: string, listener: CaptureJobListener): () => void {
      if (captureId === CAPTURE_ID && terminal) {
        listener({ type: terminal.status === 'failed' ? 'failed' : 'done', snapshot: terminal })
      }
      return () => {}
    },
  }
}

describe('capture routes', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), 'capture-routes-'))
  })

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  })

  function buildApp(manager: CaptureJobManager, registry = createWorkspaceRegistry()): express.Express {
    const app = express()
    app.use(express.json())
    app.use('/api', createCaptureRoutes({ manager, registry, workspaceRoot }))
    return app
  }

  it('returns 400 when the url field is missing', async () => {
    const response = await request(buildApp(fakeManager())).post('/api/capture').send({})
    expect(response.status).toBe(400)
    expect(response.body.error).toBeTruthy()
  })

  it('returns 400 for a non-http(s) url', async () => {
    const response = await request(buildApp(fakeManager())).post('/api/capture').send({ url: 'ftp://example.com' })
    expect(response.status).toBe(400)
  })

  it('returns 202 with the initial snapshot and the requested mode', async () => {
    const response = await request(buildApp(fakeManager()))
      .post('/api/capture')
      .send({ url: 'https://example.com', mode: 'single-page' })

    expect(response.status).toBe(202)
    expect(response.body.captureId).toBe(CAPTURE_ID)
    expect(response.body.mode).toBe('single-page')
    expect(response.body.status).toBe('running')
  })

  it('streams a terminal SSE event for a job that has already settled', async () => {
    const terminal: CaptureJobSnapshot = {
      ...runningSnapshot('whole-site'),
      status: 'complete',
      report: null,
      expiresAt: Date.now() + 60_000,
    }
    const response = await request(buildApp(fakeManager(terminal))).get(`/api/capture/${CAPTURE_ID}/events`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    expect(response.text).toContain('event: done')
  })

  it('returns 404 on the events stream for an unknown capture', async () => {
    const response = await request(buildApp(fakeManager())).get('/api/capture/nope/events')
    expect(response.status).toBe(404)
  })

  it('returns 404 downloading an unknown/expired capture', async () => {
    const response = await request(buildApp(fakeManager())).get('/api/capture/nope/download')
    expect(response.status).toBe(404)
  })

  it('streams a well-formed zip of a retained workspace on download', async () => {
    const siteDir = path.join(workspaceRoot, 'site')
    const metaDir = path.join(workspaceRoot, 'meta')
    await fs.mkdir(siteDir, { recursive: true })
    await fs.mkdir(metaDir, { recursive: true })
    await fs.writeFile(path.join(siteDir, 'index.html'), '<html><body>home</body></html>')

    const registry = createWorkspaceRegistry()
    registry.register({ captureId: CAPTURE_ID, siteDir, metaDir, entryUrl: 'https://example.com', ttlMs: 60_000 })

    const response = await request(buildApp(fakeManager(), registry))
      .get(`/api/capture/${CAPTURE_ID}/download`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => callback(null, Buffer.concat(chunks)))
      })

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/zip')
    expect(response.headers['content-disposition']).toBe('attachment; filename="example.com.zip"')
    expect((response.body as Buffer).subarray(0, 4)).toEqual(ZIP_LOCAL_FILE_HEADER_MAGIC)
  })

  it('serves the preview index with root-relative URLs rewritten under the preview prefix', async () => {
    const siteDir = path.join(workspaceRoot, 'site')
    const metaDir = path.join(workspaceRoot, 'meta')
    await fs.mkdir(siteDir, { recursive: true })
    await fs.mkdir(metaDir, { recursive: true })
    await fs.writeFile(path.join(siteDir, 'index.html'), '<html><body><img src="/framerusercontent.com/x.png"></body></html>')

    const registry = createWorkspaceRegistry()
    registry.register({ captureId: CAPTURE_ID, siteDir, metaDir, entryUrl: 'https://example.com', ttlMs: 60_000 })

    const response = await request(buildApp(fakeManager(), registry)).get(`/api/capture/${CAPTURE_ID}/preview/`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.text).toContain(`/api/capture/${CAPTURE_ID}/preview/framerusercontent.com/x.png`)
  })

  it('serves a preview asset with its content type and 404s outside the workspace', async () => {
    const siteDir = path.join(workspaceRoot, 'site')
    const metaDir = path.join(workspaceRoot, 'meta')
    await fs.mkdir(path.join(siteDir, 'framerusercontent.com'), { recursive: true })
    await fs.mkdir(metaDir, { recursive: true })
    await fs.writeFile(path.join(siteDir, 'framerusercontent.com', 'x.png'), Buffer.alloc(10, 1))

    const registry = createWorkspaceRegistry()
    registry.register({ captureId: CAPTURE_ID, siteDir, metaDir, entryUrl: 'https://example.com', ttlMs: 60_000 })
    const app = buildApp(fakeManager(), registry)

    const asset = await request(app).get(`/api/capture/${CAPTURE_ID}/preview/framerusercontent.com/x.png`)
    expect(asset.status).toBe(200)
    expect(asset.headers['content-type']).toContain('image/png')

    const missing = await request(app).get(`/api/capture/${CAPTURE_ID}/preview/does-not-exist.png`)
    expect(missing.status).toBe(404)
  })
})
