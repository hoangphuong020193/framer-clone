import fs from 'node:fs/promises'
import path from 'node:path'
import { rewritePreviewHtml } from '../functions/previewHtmlRewrite.function.js'
import { resolvePreviewCandidates } from '../functions/previewPath.function.js'
import { PREVIEW_MIME_FALLBACK, PREVIEW_MIME_TYPES } from '../models/preview.model.js'
import type { ResolvedPreviewFile } from '../models/preview.model.js'

/**
 * Resolves a preview request against a retained workspace's `siteDir` and reads
 * the matching file, returning null when nothing safe/existing matches (so the
 * route can 404). HTML is rewritten so its root-relative URLs resolve under the
 * preview prefix; every other asset is returned as raw bytes. Reads whole files
 * into memory — safe here because capture size caps already bound each file.
 */
export async function readPreviewFile(
  siteDir: string,
  requestPath: string,
  previewBasePath: string,
): Promise<ResolvedPreviewFile | null> {
  const candidates = resolvePreviewCandidates(siteDir, requestPath)

  for (const filePath of candidates) {
    let isFile: boolean
    try {
      isFile = (await fs.stat(filePath)).isFile()
    } catch {
      continue
    }
    if (!isFile) continue

    const ext = path.extname(filePath).toLowerCase()
    const contentType = PREVIEW_MIME_TYPES[ext] ?? PREVIEW_MIME_FALLBACK

    if (ext === '.html') {
      const html = await fs.readFile(filePath, 'utf-8')
      return { contentType, body: rewritePreviewHtml(html, previewBasePath) }
    }
    return { contentType, body: await fs.readFile(filePath) }
  }

  return null
}
