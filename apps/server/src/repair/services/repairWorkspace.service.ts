import fs from 'node:fs/promises'
import path from 'node:path'
import { repairHtml } from '../functions/repairHtml.function.js'
import { STATIC_SERVER_README, STATIC_SERVER_SOURCE } from '../models/staticServerAssets.model.js'
import type { RepairWorkspaceResult } from '../models/repair.model.js'
import { buildCapturedPathIndex } from './localFileIndex.service.js'

/**
 * Post-crawl pass (Phase 4): rewrites every captured HTML file's absolute
 * references to root-relative local paths (only for what was actually
 * captured) and strips known non-functional scripts, then bundles a minimal
 * static server + README so the archive is directly browsable offline.
 *
 * Runs against the finished workspace on disk rather than in-memory capture
 * state, so it stays decoupled from `ResourceStore`/`crawlSite` and is
 * re-runnable independently.
 */
export async function repairWorkspace(siteDir: string, siteOrigin: string): Promise<RepairWorkspaceResult> {
  const capturedPaths = await buildCapturedPathIndex(siteDir)
  const isCaptured = (relativeLocalPath: string): boolean => capturedPaths.has(relativeLocalPath)

  const htmlPaths = [...capturedPaths].filter((p) => p.endsWith('.html'))
  for (const relativePath of htmlPaths) {
    const fullPath = path.join(siteDir, relativePath)
    const original = await fs.readFile(fullPath, 'utf-8')
    // Confirmed in Phase 0: Framer's captured markup uses absolute URLs for
    // every resource/link reference, so a page-specific base URL is not
    // needed for relative-URL resolution here — siteOrigin alone suffices.
    const repaired = repairHtml(original, { baseUrl: siteOrigin, siteOrigin, isCaptured })
    if (repaired !== original) await fs.writeFile(fullPath, repaired, 'utf-8')
  }

  await fs.writeFile(path.join(siteDir, 'serve.cjs'), STATIC_SERVER_SOURCE, 'utf-8')
  await fs.writeFile(path.join(siteDir, 'README.md'), STATIC_SERVER_README, 'utf-8')

  return { htmlFilesRepaired: htmlPaths.length }
}
