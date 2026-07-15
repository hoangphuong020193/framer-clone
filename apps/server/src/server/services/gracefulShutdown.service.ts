import { DEFAULT_SHUTDOWN_GRACE_PERIOD_MS } from '../models/gracefulShutdown.model.js'
import type { GracefulShutdownDeps } from '../models/gracefulShutdown.model.js'

/**
 * Stops accepting new connections, waits (up to a grace period) for existing
 * ones to drain — force-closing them if the grace period elapses — then
 * closes the shared browser. Waiting for `server.close()` to actually finish
 * before touching the browser matters: without it, a request dispatched on
 * an already-open keep-alive connection just before shutdown could still
 * reach a handler after the browser is closed, silently relaunching a fresh
 * one (`getSharedBrowser()` launches lazily) in what's supposed to be
 * shutdown.
 */
export async function shutdownGracefully(deps: GracefulShutdownDeps): Promise<void> {
  const { server, closeBrowser, gracePeriodMs = DEFAULT_SHUTDOWN_GRACE_PERIOD_MS } = deps

  const closed = new Promise<void>((resolve) => server.close(() => resolve()))

  const forceCloseTimer = setTimeout(() => {
    server.closeAllConnections()
  }, gracePeriodMs)
  forceCloseTimer.unref()

  await closed
  clearTimeout(forceCloseTimer)
  await closeBrowser()
}
