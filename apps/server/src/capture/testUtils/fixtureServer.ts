import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FixtureServer, RouteHandler } from './fixtureServer.model.js'

export type { FixtureServer, RouteHandler } from './fixtureServer.model.js'

/** Minimal local HTTP fixture server for capture-pipeline tests — no real network calls. */
export async function startFixtureServer(routes: Record<string, RouteHandler>): Promise<FixtureServer> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const handler = routes[url.pathname]
    if (!handler) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    handler(req, res)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
