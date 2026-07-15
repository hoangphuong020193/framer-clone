import { afterEach, describe, expect, it } from 'vitest'
import { closeSharedBrowser, getSharedBrowser } from './browserLifecycle.service.js'

describe('browserLifecycle', () => {
  afterEach(async () => {
    await closeSharedBrowser()
  })

  it('memoizes the launched browser across calls', async () => {
    const first = await getSharedBrowser()
    const second = await getSharedBrowser()
    expect(second).toBe(first)
  })

  it('closes the browser and launches a fresh one on the next call after close', async () => {
    const first = await getSharedBrowser()
    await closeSharedBrowser()
    expect(first.isConnected()).toBe(false)

    const second = await getSharedBrowser()
    expect(second).not.toBe(first)
    expect(second.isConnected()).toBe(true)
  })

  it('is a no-op to close when no browser has been launched', async () => {
    await expect(closeSharedBrowser()).resolves.toBeUndefined()
  })

  it('returns the same instance when called concurrently before the first launch resolves', async () => {
    const [first, second] = await Promise.all([getSharedBrowser(), getSharedBrowser()])
    expect(second).toBe(first)
  })
})
