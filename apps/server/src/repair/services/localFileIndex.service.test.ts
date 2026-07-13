import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCapturedPathIndex } from './localFileIndex.service.js'

describe('buildCapturedPathIndex', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repair-index-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('lists top-level files as relative POSIX paths', async () => {
    await fs.writeFile(path.join(tempDir, 'index.html'), '<html></html>')

    const result = await buildCapturedPathIndex(tempDir)

    expect(result.has('index.html')).toBe(true)
    expect(result.size).toBe(1)
  })

  it('recurses into nested directories and joins paths with forward slashes', async () => {
    await fs.mkdir(path.join(tempDir, 'framerusercontent.com', 'images'), { recursive: true })
    await fs.writeFile(path.join(tempDir, 'framerusercontent.com', 'images', 'pic.png'), 'data')
    await fs.mkdir(path.join(tempDir, 'about'), { recursive: true })
    await fs.writeFile(path.join(tempDir, 'about', 'index.html'), '<html></html>')

    const result = await buildCapturedPathIndex(tempDir)

    expect(result.has('framerusercontent.com/images/pic.png')).toBe(true)
    expect(result.has('about/index.html')).toBe(true)
    expect(result.size).toBe(2)
  })

  it('returns an empty set for an empty directory', async () => {
    const result = await buildCapturedPathIndex(tempDir)

    expect(result.size).toBe(0)
  })
})
