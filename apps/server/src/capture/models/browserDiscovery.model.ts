export interface DiscoveryResult {
  /** Resource URLs the browser actually requested and got a final (non-redirect) response for. */
  observedResourceUrls: Set<string>
  /** URLs the browser fetched via a 206 Partial Content response — must be re-fetched whole. */
  rangeRequestedUrls: Set<string>
  sameOriginLinks: string[]
  renderedHtml: string
}
