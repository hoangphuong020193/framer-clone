import fs from 'node:fs/promises'
import path from 'node:path'
import type { CrawlReport } from '../models/crawl.model.js'

export const CAPTURE_REPORT_FILENAME = '_capture-report.json'

/** Writes the finished crawl report into siteDir so it's bundled into the Phase 5 zip. */
export async function writeCaptureReport(siteDir: string, report: CrawlReport): Promise<void> {
  await fs.writeFile(path.join(siteDir, CAPTURE_REPORT_FILENAME), JSON.stringify(report, null, 2), 'utf-8')
}
