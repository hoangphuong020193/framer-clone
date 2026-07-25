const DEFAULT_DOWNLOAD_FILENAME = 'capture.zip'

/**
 * Derives a filesystem-safe `.zip` filename from the capture's entry URL
 * hostname (e.g. `https://example.framer.website/` -> `example.framer.website.zip`),
 * falling back to a generic name when the URL is missing or unparsable.
 */
export function buildDownloadFilename(entryUrl: string | undefined): string {
  if (!entryUrl) return DEFAULT_DOWNLOAD_FILENAME

  let hostname: string
  try {
    hostname = new URL(entryUrl).hostname
  } catch {
    return DEFAULT_DOWNLOAD_FILENAME
  }

  const sanitized = hostname.replace(/[^a-zA-Z0-9.-]/g, '-')
  return sanitized === '' ? DEFAULT_DOWNLOAD_FILENAME : `${sanitized}.zip`
}
