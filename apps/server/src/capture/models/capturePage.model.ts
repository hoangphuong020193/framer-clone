import type { Browser } from 'playwright'
import type { FetchDeps } from './fetchResource.model.js'
import type { ResourceStorePort } from './resourceStore.model.js'

export interface CapturePageOptions {
  pageUrl: string
  siteOrigin: string
  /** Becomes the zip — only ever written to by this function's resource store. */
  siteDir: string
  /** Sibling of siteDir, never bundled into the archive. */
  metaDir: string
  store: ResourceStorePort
  browser: Browser
  fetchDeps?: FetchDeps
}

export interface CapturedResourceRecord {
  url: string
  localPath: string
  bytes: number
}

export interface PageCaptureResult {
  pageUrl: string
  status: 'captured' | 'degraded' | 'failed'
  localHtmlPath: string | null
  resources: CapturedResourceRecord[]
  sameOriginLinks: string[]
  /** Path under metaDir (never the archive's site/ tree) — Tier 2's input only. */
  renderedDomPath: string | null
  warnings: string[]
}
