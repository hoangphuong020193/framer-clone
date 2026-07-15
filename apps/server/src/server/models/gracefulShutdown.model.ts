import type { Server } from 'node:http'

export const DEFAULT_SHUTDOWN_GRACE_PERIOD_MS = 5000

export interface GracefulShutdownDeps {
  server: Server
  closeBrowser: () => Promise<void>
  gracePeriodMs?: number
}
