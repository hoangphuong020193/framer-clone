import http, { type Server } from 'node:http'
import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shutdownGracefully } from './gracefulShutdown.service.js'

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

describe('shutdownGracefully', () => {
  let server: Server
  let socket: net.Socket | undefined

  afterEach(() => {
    socket?.destroy()
    if (server.listening) server.close()
  })

  it('closes the browser only after the server has finished closing', async () => {
    server = http.createServer((_req, res) => res.end('ok'))
    await listen(server)

    const events: string[] = []
    const closeBrowser = vi.fn(async () => {
      events.push('browser-closed')
    })

    await shutdownGracefully({ server, closeBrowser, gracePeriodMs: 1000 })

    expect(closeBrowser).toHaveBeenCalledTimes(1)
    expect(server.listening).toBe(false)
    expect(events).toEqual(['browser-closed'])
  })

  it('force-closes lingering keep-alive connections once the grace period elapses, rather than hanging', async () => {
    server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)

    // Open a raw socket and never send a request — simulates an idle
    // keep-alive connection that would otherwise block server.close() forever.
    socket = net.connect(port, '127.0.0.1')
    await new Promise((resolve) => socket?.on('connect', resolve))

    const closeBrowser = vi.fn(async () => {})
    const start = Date.now()

    await shutdownGracefully({ server, closeBrowser, gracePeriodMs: 100 })

    expect(Date.now() - start).toBeLessThan(2000)
    expect(closeBrowser).toHaveBeenCalledTimes(1)
  })

  it('does not force-close connections if they drain before the grace period', async () => {
    server = http.createServer((_req, res) => res.end('ok'))
    await listen(server)

    const closeAllConnectionsSpy = vi.spyOn(server, 'closeAllConnections')
    const closeBrowser = vi.fn(async () => {})

    await shutdownGracefully({ server, closeBrowser, gracePeriodMs: 5000 })

    expect(closeAllConnectionsSpy).not.toHaveBeenCalled()
  })
})
