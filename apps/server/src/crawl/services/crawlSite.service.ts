import fs from 'node:fs/promises'
import { capturePage } from '../../capture/services/capturePage.service.js'
import { ResourceStore } from '../../capture/services/resourceStore.service.js'
import { normalizePageUrl } from '../functions/normalizeUrl.function.js'
import { capturedPageEntry, failedPageEntry, skippedBudgetPageEntry } from '../functions/pageReportEntry.function.js'
import type { CrawlPageReportEntry, CrawlReport, CrawlSiteOptions } from '../models/crawl.model.js'
import { repairWorkspace } from '../../repair/services/repairWorkspace.service.js'
import { writeCaptureReport } from './crawlReportFile.service.js'
import { discoverSitemapUrls } from './sitemap.service.js'
import { createWallClockQueue } from './wallClockQueue.service.js'
import { WorkspaceBudget } from './workspaceBudget.service.js'

export type { CrawlPageReportEntry, CrawlProgress, CrawlReport, CrawlSiteOptions } from '../models/crawl.model.js'
export { CAPTURE_REPORT_FILENAME } from './crawlReportFile.service.js'

const DEFAULT_CONCURRENCY = 4
const DEFAULT_MAX_WORKSPACE_BYTES = 2 * 1024 * 1024 * 1024 // 2GB
const DEFAULT_WALL_CLOCK_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Whole-site BFS crawl: seeds the queue from the sitemap (falls back to just
 * the entry URL if there isn't one), then a worker pool pops URLs, captures
 * each page (Phase 2's `capturePage`), and pushes newly-discovered
 * same-origin links back onto the queue until nothing new is found or a
 * guardrail (wall-clock timeout / workspace size cap) trips.
 */
export async function crawlSite(opts: CrawlSiteOptions): Promise<CrawlReport> {
  const {
    entryUrl,
    siteDir,
    metaDir,
    browser,
    concurrency = DEFAULT_CONCURRENCY,
    maxWorkspaceBytes = DEFAULT_MAX_WORKSPACE_BYTES,
    wallClockTimeoutMs = DEFAULT_WALL_CLOCK_TIMEOUT_MS,
    onProgress,
    fetchDeps,
  } = opts

  const siteOrigin = new URL(entryUrl).origin
  const normalizedEntry = normalizePageUrl(entryUrl, siteOrigin)
  if (!normalizedEntry) {
    throw new Error(`Entry URL is not a valid same-origin http(s) URL: ${entryUrl}`)
  }

  // Must exist before the final report write: if every page fails before
  // ResourceStore's lazy mkdir-on-first-write ever runs (e.g. the whole site
  // is down), crawlSite must still be able to write `_capture-report.json`.
  await fs.mkdir(siteDir, { recursive: true })

  const store = new ResourceStore(siteDir)
  const budget = new WorkspaceBudget(maxWorkspaceBytes)
  const startedAt = new Date().toISOString()

  const seen = new Set<string>()
  const pages: CrawlPageReportEntry[] = []
  let trippedWorkspaceCap = false

  const queue = createWallClockQueue(concurrency, wallClockTimeoutMs)

  // onProgress is a caller-supplied reporting callback — a throw from it must
  // never crash the crawl or be mistaken for a page-capture failure.
  const reportProgress = (): void => {
    try {
      onProgress?.({ captured: pages.length, total: seen.size })
    } catch {
      // Swallowed: this is a progress notification, not part of the capture result.
    }
  }

  // Reserve synchronously (check-then-add with no `await` in between) so two
  // concurrent workers discovering the same link can't both enqueue it — the
  // same pattern used for ResourceStore's write-once guarantee. Also no-ops
  // once the wall clock has tripped, since sitemap discovery can itself run
  // longer than wallClockTimeoutMs (see `wallClockQueue.service.ts`'s docstring).
  const enqueue = (rawUrl: string): void => {
    if (queue.isTripped()) return
    const normalized = normalizePageUrl(rawUrl, siteOrigin)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    void queue.add(() => processUrl(normalized)).catch((error: unknown) => {
      pages.push(failedPageEntry(normalized, error))
    })
  }

  async function processUrl(pageUrl: string): Promise<void> {
    if (queue.isTripped()) return

    const reservation = budget.tryReserve()
    if (!reservation.reserved) {
      trippedWorkspaceCap = true
      pages.push(skippedBudgetPageEntry(pageUrl))
      reportProgress()
      return
    }

    try {
      const result = await capturePage({ pageUrl, siteOrigin, siteDir, metaDir, store, browser, fetchDeps })
      const bytesCaptured = result.resources.reduce((sum, r) => sum + r.bytes, 0)
      budget.settle(reservation.estimateBytes, bytesCaptured)
      pages.push(capturedPageEntry(pageUrl, result, bytesCaptured))

      if (!queue.isTripped()) {
        for (const link of result.sameOriginLinks) enqueue(link)
      }
    } catch (error: unknown) {
      budget.settle(reservation.estimateBytes, 0)
      pages.push(failedPageEntry(pageUrl, error))
    } finally {
      reportProgress()
    }
  }

  const sitemapUrls = await discoverSitemapUrls(siteOrigin, fetchDeps).catch(() => [] as string[])
  enqueue(normalizedEntry)
  for (const url of sitemapUrls) enqueue(url)

  await queue.onIdle()
  queue.stop()

  // Best-effort: a repair failure must not lose an otherwise-successful
  // crawl. Raw captured files are left as-is (still browsable, just with
  // absolute live-site references) if this throws.
  try {
    await repairWorkspace(siteDir, siteOrigin)
  } catch (error: unknown) {
    console.error(`Repair pass failed for ${siteDir}, serving raw captured files instead:`, error)
  }

  const finishedAt = new Date().toISOString()
  const trippedWallClock = queue.isTripped()
  const status: CrawlReport['status'] = trippedWallClock || trippedWorkspaceCap ? 'partial' : 'complete'

  const report: CrawlReport = {
    status,
    startedAt,
    finishedAt,
    entryUrl: normalizedEntry,
    totalPagesDiscovered: seen.size,
    totalBytesCaptured: budget.used,
    workspaceCapBytes: maxWorkspaceBytes,
    wallClockTimeoutMs,
    trippedWallClock,
    trippedWorkspaceCap,
    pagesDroppedByTimeout: queue.pagesDroppedByTimeout(),
    pages,
  }

  await writeCaptureReport(siteDir, report)

  return report
}
