import type { SafeFetchTarget } from './ssrf.model.js'

export interface FetchedResource {
  finalUrl: string
  status: number
  contentType: string | null
  body: Buffer
  /** URLs visited before the final response, in order — recorded, not persisted as bytes. */
  redirectChain: string[]
}

export interface FetchDeps {
  resolveTarget?: (url: string) => Promise<SafeFetchTarget>
  /** Override for testing the streamed size cap without transferring real gigabytes. */
  maxResponseBytes?: number
}
