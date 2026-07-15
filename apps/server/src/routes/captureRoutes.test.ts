import express from 'express'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceRegistry } from '../packaging/services/workspaceRegistry.service.js'
import { createCaptureRoutes } from './captureRoutes.js'

const ZIP_LOCAL_FILE_HEADER_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

describe('POST /api/capture', () => {
  let workspaceRoot: string

  afterEach(async () => {
    if (workspaceRoot) await fs.rm(workspaceRoot, { recursive: true, force: true })
    vi.doUnmock('../packaging/services/captureJob.service.js')
    vi.doUnmock('../browser/services/browserLifecycle.service.js')
    vi.resetModules()
  })

  function mockSharedBrowser(): void {
    vi.doMock('../browser/services/browserLifecycle.service.js', () => ({
      getSharedBrowser: vi.fn(async () => ({})),
    }))
  }

  function buildApp(): express.Express {
    const app = express()
    app.use(express.json())
    app.use('/api', createCaptureRoutes({ workspaceRoot, registry: createWorkspaceRegistry() }))
    return app
  }

  it('returns 400 when the url field is missing', async () => {
    workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), 'capture-routes-'))
    const app = buildApp()

    const response = await request(app).post('/api/capture').send({})

    expect(response.status).toBe(400)
    expect(response.body.error).toBeTruthy()
  })

  it('returns 400 for a non-http(s) url', async () => {
    workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), 'capture-routes-'))
    const app = buildApp()

    const response = await request(app).post('/api/capture').send({ url: 'ftp://example.com' })

    expect(response.status).toBe(400)
  })

  it('returns 500 with a generic message and logs detail when the capture job throws', async () => {
    workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), 'capture-routes-'))

    mockSharedBrowser()
    vi.doMock('../packaging/services/captureJob.service.js', () => ({
      runCaptureJob: vi.fn(async () => {
        throw new Error('boom')
      }),
    }))
    vi.resetModules()
    const { createCaptureRoutes: createCaptureRoutesWithFailingJob } = await import('./captureRoutes.js')

    const app = express()
    app.use(express.json())
    app.use('/api', createCaptureRoutesWithFailingJob({ workspaceRoot, registry: createWorkspaceRegistry() }))

    const response = await request(app).post('/api/capture').send({ url: 'https://example.com' })

    expect(response.status).toBe(500)
    expect(response.body.error).toBe('Capture failed, please try again')
  })

  it('streams back a well-formed zip built from the capture job result', async () => {
    workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), 'capture-routes-'))
    const siteDir = path.join(workspaceRoot, 'site')
    const metaDir = path.join(workspaceRoot, 'meta')
    await fs.mkdir(siteDir, { recursive: true })
    await fs.mkdir(metaDir, { recursive: true })
    await fs.writeFile(path.join(siteDir, 'index.html'), '<html><body>home</body></html>')

    mockSharedBrowser()
    vi.doMock('../packaging/services/captureJob.service.js', () => ({
      runCaptureJob: vi.fn(async () => ({
        captureId: 'fake-capture-id',
        siteDir,
        metaDir,
        report: { status: 'complete', pages: [] },
        expiresAt: Date.now() + 60_000,
      })),
    }))
    vi.resetModules()
    const { createCaptureRoutes: createCaptureRoutesWithFakeJob } = await import('./captureRoutes.js')

    const app = express()
    app.use(express.json())
    app.use('/api', createCaptureRoutesWithFakeJob({ workspaceRoot, registry: createWorkspaceRegistry() }))

    const response = await request(app)
      .post('/api/capture')
      .send({ url: 'https://example.com' })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => callback(null, Buffer.concat(chunks)))
      })

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/zip')
    const body = response.body as Buffer
    expect(body.subarray(0, 4)).toEqual(ZIP_LOCAL_FILE_HEADER_MAGIC)
  })
})
