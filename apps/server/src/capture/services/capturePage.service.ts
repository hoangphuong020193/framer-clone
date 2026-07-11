import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Browser } from 'playwright'
import type { CapturedResourceRecord, CapturePageOptions, PageCaptureResult } from '../models/capturePage.model.js'
import type { FetchDeps } from '../models/fetchResource.model.js'
import type { ResourceStorePort } from '../models/resourceStore.model.js'
import { scanHtmlForResources } from '../functions/htmlResourceScan.function.js'
import { urlToLocalPath } from '../functions/urlPathMapping.function.js'
import { discoverPage } from './browserDiscovery.service.js'
import { fetchRaw } from './fetchResource.service.js'

export type { CapturePageOptions } from '../models/capturePage.model.js'

const PER_PAGE_TIMEOUT_MS = 20000

export async function capturePage(opts: CapturePageOptions): Promise<PageCaptureResult> {
  const { pageUrl, siteOrigin, metaDir, store, browser, fetchDeps } = opts
  const warnings: string[] = []

  try {
    return await withTimeout(PER_PAGE_TIMEOUT_MS, pageUrl, () =>
      captureOnce({ pageUrl, siteOrigin, metaDir, store, browser, fetchDeps, warnings }),
    )
  } catch (err) {
    return {
      pageUrl,
      status: 'failed',
      localHtmlPath: null,
      resources: [],
      sameOriginLinks: [],
      renderedDomPath: null,
      warnings: [...warnings, (err as Error).message],
    }
  }
}

async function captureOnce(args: {
  pageUrl: string
  siteOrigin: string
  metaDir: string
  store: ResourceStorePort
  browser: Browser
  fetchDeps: FetchDeps | undefined
  warnings: string[]
}): Promise<PageCaptureResult> {
  const { pageUrl, siteOrigin, metaDir, store, browser, fetchDeps, warnings } = args

  // 1. HTTP-first: raw document body, persisted verbatim (never a re-serialized/parsed form).
  const doc = await fetchRaw(pageUrl, fetchDeps)
  const docUrl = new URL(doc.finalUrl)
  const htmlLocalPath = urlToLocalPath(docUrl, siteOrigin)
  await store.writeIfNew(doc.finalUrl, htmlLocalPath, doc.body)
  const htmlText = doc.body.toString('utf-8')

  // 2. Statically-declared resources from the raw HTML/CSS.
  const resources: CapturedResourceRecord[] = []
  const scanned = scanHtmlForResources(htmlText, doc.finalUrl)
  for (const { absoluteUrl } of scanned) {
    await captureOneResource(absoluteUrl, siteOrigin, store, resources, warnings, fetchDeps)
  }

  // 3. Playwright discovery pass — lazy/interaction-triggered requests, same-origin links, DOM snapshot.
  let sameOriginLinks: string[] = []
  let renderedDomPath: string | null = null
  try {
    const discovery = await discoverPage(browser, pageUrl, siteOrigin, fetchDeps)
    sameOriginLinks = discovery.sameOriginLinks

    const alreadyKnown = new Set(resources.map((r) => r.url))
    alreadyKnown.add(doc.finalUrl)

    for (const url of discovery.observedResourceUrls) {
      if (alreadyKnown.has(url)) continue
      await captureOneResource(url, siteOrigin, store, resources, warnings, fetchDeps)
    }
    for (const url of discovery.rangeRequestedUrls) {
      if (alreadyKnown.has(url)) continue
      // Don't trust the browser's partial (Range-requested) body — re-fetch whole ourselves.
      await captureOneResource(url, siteOrigin, store, resources, warnings, fetchDeps)
    }

    renderedDomPath = await saveRenderedDomSnapshot(metaDir, pageUrl, discovery.renderedHtml)
  } catch (err) {
    warnings.push(`Playwright discovery pass failed: ${(err as Error).message}`)
  }

  return {
    pageUrl,
    status: warnings.length > 0 ? 'degraded' : 'captured',
    localHtmlPath: htmlLocalPath,
    resources,
    sameOriginLinks,
    renderedDomPath,
    warnings,
  }
}

async function captureOneResource(
  absoluteUrl: string,
  siteOrigin: string,
  store: ResourceStorePort,
  resources: CapturedResourceRecord[],
  warnings: string[],
  fetchDeps: FetchDeps | undefined,
): Promise<void> {
  if (store.has(absoluteUrl)) return
  try {
    const fetched = await fetchRaw(absoluteUrl, fetchDeps)
    const url = new URL(fetched.finalUrl)
    const localPath = urlToLocalPath(url, siteOrigin)
    const { wasNew } = await store.writeIfNew(fetched.finalUrl, localPath, fetched.body)
    if (wasNew) resources.push({ url: fetched.finalUrl, localPath, bytes: fetched.body.length })
  } catch (err) {
    warnings.push(`Failed to fetch resource ${absoluteUrl}: ${(err as Error).message}`)
  }
}

async function saveRenderedDomSnapshot(metaDir: string, pageUrl: string, html: string): Promise<string> {
  const fileName = `${crypto.createHash('sha1').update(pageUrl).digest('hex')}.html`
  const relativePath = path.join('rendered-dom', fileName)
  const fullPath = path.join(metaDir, relativePath)
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, html, 'utf-8')
  return relativePath
}

async function withTimeout<T>(ms: number, label: string, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out capturing ${label} after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([fn(), timeout])
  } finally {
    clearTimeout(timer!)
  }
}
