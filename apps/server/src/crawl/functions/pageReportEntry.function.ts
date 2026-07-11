import type { PageCaptureResult } from '../../capture/models/capturePage.model.js'
import type { CrawlPageReportEntry } from '../models/crawl.model.js'

export function capturedPageEntry(
  pageUrl: string,
  result: PageCaptureResult,
  bytesCaptured: number,
): CrawlPageReportEntry {
  return {
    url: pageUrl,
    status: result.status,
    localHtmlPath: result.localHtmlPath,
    resourceCount: result.resources.length,
    bytesCaptured,
    warnings: result.warnings,
  }
}

export function skippedBudgetPageEntry(pageUrl: string): CrawlPageReportEntry {
  return {
    url: pageUrl,
    status: 'skipped-budget',
    localHtmlPath: null,
    resourceCount: 0,
    bytesCaptured: 0,
    warnings: ['Workspace size cap reached before this page could be captured'],
  }
}

export function failedPageEntry(pageUrl: string, error: unknown): CrawlPageReportEntry {
  return {
    url: pageUrl,
    status: 'failed',
    localHtmlPath: null,
    resourceCount: 0,
    bytesCaptured: 0,
    warnings: [error instanceof Error ? error.message : String(error)],
  }
}
