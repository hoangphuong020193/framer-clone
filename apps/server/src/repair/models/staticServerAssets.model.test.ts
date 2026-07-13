import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STATIC_SERVER_SOURCE } from './staticServerAssets.model.js'

const TEST_PORT = 39217

function get(port: number, requestPath: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: requestPath }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
    })
    req.on('error', reject)
  })
}

async function waitForServer(port: number, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await get(port, '/')
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error('bundled static server did not start in time')
}

describe('STATIC_SERVER_SOURCE (bundled serve.cjs, run as a real child process)', () => {
  let tempDir: string
  let child: ChildProcess

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'static-server-'))
    await fs.writeFile(path.join(tempDir, 'index.html'), '<html>home</html>')
    await fs.writeFile(path.join(tempDir, 'serve.cjs'), STATIC_SERVER_SOURCE)
    child = spawn(process.execPath, ['serve.cjs', String(TEST_PORT)], { cwd: tempDir })
    await waitForServer(TEST_PORT)
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve())
      child.kill()
    })
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('serves index.html at the root', async () => {
    const result = await get(TEST_PORT, '/')
    expect(result.status).toBe(200)
  })

  it('returns 404 instead of crashing on a malformed request path', async () => {
    const malformed = await get(TEST_PORT, '/%')
    expect(malformed.status).toBe(404)

    // The process must still be alive and serving after the malformed request.
    const followUp = await get(TEST_PORT, '/')
    expect(followUp.status).toBe(200)
  })

  it('does not escape the served root on a path-traversal attempt', async () => {
    const result = await get(TEST_PORT, '/../../../../etc/passwd')
    expect(result.status).toBe(404)
  })
})
