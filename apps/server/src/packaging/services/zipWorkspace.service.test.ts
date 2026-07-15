import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkspaceZipStream, streamWorkspaceZip } from './zipWorkspace.service.js'

const ZIP_LOCAL_FILE_HEADER_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // 'PK\x03\x04'

function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

describe('createWorkspaceZipStream', () => {
  let siteDir: string

  beforeEach(async () => {
    siteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-workspace-'))
    await fs.writeFile(path.join(siteDir, 'index.html'), '<html><body>home</body></html>')
    await fs.mkdir(path.join(siteDir, 'framerusercontent.com'), { recursive: true })
    await fs.writeFile(path.join(siteDir, 'framerusercontent.com', 'pic.png'), Buffer.alloc(100, 7))
  })

  afterEach(async () => {
    await fs.rm(siteDir, { recursive: true, force: true })
  })

  it('produces a well-formed, non-empty zip stream', async () => {
    const archive = createWorkspaceZipStream(siteDir)
    const buffer = await collectStream(archive)

    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer.subarray(0, 4)).toEqual(ZIP_LOCAL_FILE_HEADER_MAGIC)
  })

  it('reports a final byte count matching the streamed output', async () => {
    const archive = createWorkspaceZipStream(siteDir)
    const buffer = await collectStream(archive)

    expect(archive.pointer()).toBe(buffer.length)
  })

  it('emits an "error" event instead of an unhandled rejection when the path is not a directory', async () => {
    // archiver.directory() silently produces an empty zip for a merely
    // nonexistent path — a path that resolves to a file (ENOTDIR from the
    // underlying scandir) is what actually makes finalize() reject.
    const notADir = path.join(siteDir, 'index.html')

    const archive = createWorkspaceZipStream(notADir)
    const error = await new Promise<Error>((resolve) => {
      archive.on('error', resolve)
      archive.resume()
    })

    expect(error).toBeInstanceOf(Error)
  })
})

describe('streamWorkspaceZip', () => {
  let siteDir: string

  beforeEach(async () => {
    siteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-workspace-'))
    await fs.writeFile(path.join(siteDir, 'index.html'), '<html><body>home</body></html>')
  })

  afterEach(async () => {
    await fs.rm(siteDir, { recursive: true, force: true })
  })

  it('pipes a well-formed zip into the destination and resolves on success', async () => {
    const chunks: Buffer[] = []
    const destination = new Writable({
      write(chunk: Buffer, _enc, callback) {
        chunks.push(chunk)
        callback()
      },
    })

    await streamWorkspaceZip(siteDir, destination)

    const buffer = Buffer.concat(chunks)
    expect(buffer.subarray(0, 4)).toEqual(ZIP_LOCAL_FILE_HEADER_MAGIC)
  })

  it('rejects (rather than hanging or throwing unhandled) when the source path is not a directory', async () => {
    const destination = new Writable({
      write(_chunk, _enc, callback) {
        callback()
      },
    })

    await expect(streamWorkspaceZip(path.join(siteDir, 'index.html'), destination)).rejects.toThrow()
  })

  it('rejects when the destination errors mid-stream', async () => {
    await fs.mkdir(path.join(siteDir, 'framerusercontent.com'), { recursive: true })
    await fs.writeFile(path.join(siteDir, 'framerusercontent.com', 'pic.png'), Buffer.alloc(500_000, 7))

    const destination = new Writable({
      write(_chunk, _enc, callback) {
        callback(new Error('destination boom'))
      },
    })

    await expect(streamWorkspaceZip(siteDir, destination)).rejects.toThrow('destination boom')
  })
})
