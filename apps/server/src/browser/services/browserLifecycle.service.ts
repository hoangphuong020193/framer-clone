import { chromium, type Browser } from 'playwright'

let browserPromise: Promise<Browser> | null = null

/**
 * Lazily launches a single shared Chromium instance reused across capture
 * requests — launching Playwright is the dominant per-request latency cost,
 * so every capture job borrows this one browser rather than starting fresh.
 */
export function getSharedBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch()
  }
  return browserPromise
}

/** Closes the shared browser (if launched) — used on process shutdown. */
export async function closeSharedBrowser(): Promise<void> {
  if (!browserPromise) return
  const browser = await browserPromise
  browserPromise = null
  await browser.close()
}
