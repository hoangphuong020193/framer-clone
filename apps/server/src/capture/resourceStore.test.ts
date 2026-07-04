import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ResourceStore } from './resourceStore.js'

describe('ResourceStore', () => {
  let dir: string
  let store: ResourceStore

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'resource-store-'))
    store = new ResourceStore(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes a new resource and reports wasNew', async () => {
    const result = await store.writeIfNew('https://example.com/a.png', 'a.png', Buffer.from('hello'))
    expect(result.wasNew).toBe(true)
    expect(result.localPath).toBe('a.png')
    const written = await readFile(path.join(dir, 'a.png'))
    expect(written.toString()).toBe('hello')
  })

  it('does not re-write the same URL twice (write-once semantics)', async () => {
    await store.writeIfNew('https://example.com/a.png', 'a.png', Buffer.from('first'))
    const second = await store.writeIfNew('https://example.com/a.png', 'a.png', Buffer.from('second'))
    expect(second.wasNew).toBe(false)
    const written = await readFile(path.join(dir, 'a.png'))
    expect(written.toString()).toBe('first')
  })

  it('creates nested directories as needed', async () => {
    await store.writeIfNew('https://cdn.example.com/x/y/z.png', 'cdn.example.com/x/y/z.png', Buffer.from('data'))
    const written = await readFile(path.join(dir, 'cdn.example.com/x/y/z.png'))
    expect(written.toString()).toBe('data')
  })

  it('disambiguates a case-insensitive filename collision between two different resources', async () => {
    const first = await store.writeIfNew('https://example.com/Logo.png', 'Logo.png', Buffer.from('one'))
    const second = await store.writeIfNew('https://example.com/logo.png', 'logo.png', Buffer.from('two'))
    expect(first.localPath).toBe('Logo.png')
    expect(second.localPath).not.toBe('Logo.png')
    expect(second.wasNew).toBe(true)
    const secondContent = await readFile(path.join(dir, second.localPath))
    expect(secondContent.toString()).toBe('two')
  })

  it('has() reflects whether a URL was already written', async () => {
    expect(store.has('https://example.com/a.png')).toBe(false)
    await store.writeIfNew('https://example.com/a.png', 'a.png', Buffer.from('x'))
    expect(store.has('https://example.com/a.png')).toBe(true)
  })

  it('refuses to write outside the site root even if a caller passes a traversal path directly', async () => {
    await expect(
      store.writeIfNew('https://example.com/evil', '../outside.txt', Buffer.from('x')),
    ).rejects.toThrow(/outside site root/)
  })

  it('does not corrupt content when the same URL is written concurrently (in-flight race)', async () => {
    const [first, second] = await Promise.all([
      store.writeIfNew('https://example.com/a.png', 'a.png', Buffer.from('one')),
      store.writeIfNew('https://example.com/a.png', 'a.png', Buffer.from('two')),
    ])
    // Exactly one of the two concurrent calls should have won the write.
    expect([first.wasNew, second.wasNew].filter(Boolean)).toHaveLength(1)
    expect(first.localPath).toBe(second.localPath)
    const written = await readFile(path.join(dir, first.localPath))
    expect(['one', 'two']).toContain(written.toString())
  })

  it('does not let two different URLs colliding on the same case-folded path clobber each other when written concurrently', async () => {
    const [first, second] = await Promise.all([
      store.writeIfNew('https://example.com/Logo.png', 'Logo.png', Buffer.from('one')),
      store.writeIfNew('https://example.com/logo.png', 'logo.png', Buffer.from('two')),
    ])
    expect(first.localPath).not.toBe(second.localPath)
    const firstContent = await readFile(path.join(dir, first.localPath))
    const secondContent = await readFile(path.join(dir, second.localPath))
    expect(firstContent.toString()).toBe('one')
    expect(secondContent.toString()).toBe('two')
  })
})
