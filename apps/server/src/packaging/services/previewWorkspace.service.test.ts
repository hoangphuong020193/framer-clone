import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPreviewFile } from './previewWorkspace.service.js'

describe('readPreviewFile', () => {
  let siteDir: string

  beforeEach(async () => {
    siteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-ws-'))
    await fs.writeFile(path.join(siteDir, 'index.html'), '<html><body><img src="/img/a.png"></body></html>')
    await fs.mkdir(path.join(siteDir, 'img'), { recursive: true })
    await fs.writeFile(path.join(siteDir, 'img', 'a.png'), Buffer.alloc(5, 9))
  })

  afterEach(async () => {
    await fs.rm(siteDir, { recursive: true, force: true })
  })

  it('serves index.html for the root path with root-relative URLs rewritten', async () => {
    const file = await readPreviewFile(siteDir, '/', '/preview')
    expect(file?.contentType).toContain('text/html')
    expect(typeof file?.body).toBe('string')
    expect(file?.body).toContain('src="/preview/img/a.png"')
  })

  it('serves a binary asset as raw bytes with its content type', async () => {
    const file = await readPreviewFile(siteDir, '/img/a.png', '/preview')
    expect(file?.contentType).toContain('image/png')
    expect(Buffer.isBuffer(file?.body)).toBe(true)
    expect((file?.body as Buffer).length).toBe(5)
  })

  it('returns null for a missing file', async () => {
    expect(await readPreviewFile(siteDir, '/nope.png', '/preview')).toBeNull()
  })

  it('returns null for a traversal attempt outside the workspace', async () => {
    expect(await readPreviewFile(siteDir, '/../index.html', '/preview')).toBeNull()
  })
})
