import type http from 'node:http'

export type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void

export interface FixtureServer {
  baseUrl: string
  close: () => Promise<void>
}
