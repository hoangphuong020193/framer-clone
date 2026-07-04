import { Agent } from 'undici'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchRaw, type FetchDeps } from './fetchResource.js'
import { SsrfBlockedError, type SafeFetchTarget } from './ssrf.js'
import { startFixtureServer, type FixtureServer } from './testUtils/fixtureServer.js'

const permissiveResolver = async (rawUrl: string): Promise<SafeFetchTarget> => ({
  url: new URL(rawUrl),
  dispatcher: new Agent(),
})
const deps: FetchDeps = { resolveTarget: permissiveResolver }

describe('fetchRaw', () => {
  let server: FixtureServer

  beforeAll(async () => {
    server = await startFixtureServer({
      '/ok': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('hello world')
      },
      '/redirect-once': (_req, res) => {
        res.writeHead(302, { location: '/ok' })
        res.end()
      },
      '/redirect-loop': (_req, res) => {
        res.writeHead(302, { location: '/redirect-loop' })
        res.end()
      },
      '/redirect-no-location': (_req, res) => {
        res.writeHead(302)
        res.end()
      },
      '/redirect-5': (_req, res) => {
        res.writeHead(302, { location: '/redirect-4' })
        res.end()
      },
      '/redirect-4': (_req, res) => {
        res.writeHead(302, { location: '/redirect-3' })
        res.end()
      },
      '/redirect-3': (_req, res) => {
        res.writeHead(302, { location: '/redirect-2' })
        res.end()
      },
      '/redirect-2': (_req, res) => {
        res.writeHead(302, { location: '/redirect-1' })
        res.end()
      },
      '/redirect-1': (_req, res) => {
        res.writeHead(302, { location: '/ok' })
        res.end()
      },
      '/oversized-content-length': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(10 * 1024 * 1024 * 1024) })
        res.end('short body')
      },
      '/oversized-actual-body': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.end(Buffer.alloc(1024, 'x'))
      },
    })
  })

  afterAll(async () => {
    await server.close()
  })

  it('fetches a normal 200 response and returns the raw body', async () => {
    const result = await fetchRaw(`${server.baseUrl}/ok`, deps)
    expect(result.status).toBe(200)
    expect(result.body.toString()).toBe('hello world')
    expect(result.contentType).toBe('text/plain')
    expect(result.redirectChain).toEqual([])
  })

  it('follows a redirect and records the hop instead of returning an empty body', async () => {
    const result = await fetchRaw(`${server.baseUrl}/redirect-once`, deps)
    expect(result.status).toBe(200)
    expect(result.body.toString()).toBe('hello world')
    expect(result.redirectChain).toEqual([`${server.baseUrl}/redirect-once`])
    expect(result.finalUrl).toBe(`${server.baseUrl}/ok`)
  })

  it('throws after exceeding the max redirect count', async () => {
    await expect(fetchRaw(`${server.baseUrl}/redirect-loop`, deps)).rejects.toThrow(/Too many redirects/)
  })

  it('throws when a redirect has no Location header', async () => {
    await expect(fetchRaw(`${server.baseUrl}/redirect-no-location`, deps)).rejects.toThrow(/no Location header/)
  })

  it('re-validates SSRF on every redirect hop, not just the initial URL', async () => {
    let calls = 0
    const trackingResolver = async (rawUrl: string): Promise<SafeFetchTarget> => {
      calls++
      return permissiveResolver(rawUrl)
    }
    await fetchRaw(`${server.baseUrl}/redirect-once`, { resolveTarget: trackingResolver })
    expect(calls).toBe(2) // once for /redirect-once, once for /ok
  })

  it('by default (no injected resolver) is guarded by the real SSRF check and blocks loopback', async () => {
    await expect(fetchRaw(`${server.baseUrl}/ok`)).rejects.toThrow(SsrfBlockedError)
  })

  it('follows exactly MAX_REDIRECTS (5) hops and still succeeds on the final request', async () => {
    const result = await fetchRaw(`${server.baseUrl}/redirect-5`, deps)
    expect(result.status).toBe(200)
    expect(result.body.toString()).toBe('hello world')
    expect(result.redirectChain).toHaveLength(5)
  })

  it('throws rather than allowing a 6th redirect hop', async () => {
    // /redirect-loop always redirects to itself, so this exercises the
    // exact boundary: the 6th response (index === MAX_REDIRECTS) must be
    // rejected immediately instead of being followed as one more hop.
    await expect(fetchRaw(`${server.baseUrl}/redirect-loop`, deps)).rejects.toThrow(/Too many redirects/)
  })

  it('rejects a response whose declared Content-Length exceeds the cap without reading the body', async () => {
    await expect(fetchRaw(`${server.baseUrl}/oversized-content-length`, deps)).rejects.toThrow(/exceeds/)
  })

  it('rejects a response whose actual streamed body exceeds an injected cap, even without an honest Content-Length', async () => {
    await expect(
      fetchRaw(`${server.baseUrl}/oversized-actual-body`, { ...deps, maxResponseBytes: 100 }),
    ).rejects.toThrow(/exceeds/)
  })
})
