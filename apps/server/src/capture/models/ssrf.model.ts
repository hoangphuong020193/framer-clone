import type { Dispatcher } from 'undici'

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfBlockedError'
  }
}

export interface LookupAddress {
  address: string
  family: number
}

export type LookupFn = (hostname: string) => Promise<LookupAddress[]>

export interface SafeFetchTarget {
  url: URL
  /** undici Dispatcher pinned to the already-validated IP, closing the DNS-rebinding TOCTOU gap. */
  dispatcher: Dispatcher
}
