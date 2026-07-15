import archiver from 'archiver'
import { pipeline } from 'node:stream/promises'

/**
 * Streams a zip of `siteDir`'s contents — never written to disk itself, just
 * piped directly to the HTTP response as archiver produces it. `siteDir`'s
 * contents are already path-safe (Phase 2/3's capture path mapping), so this
 * only ever mirrors real on-disk file names into the archive.
 */
export function createWorkspaceZipStream(siteDir: string): archiver.Archiver {
  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.directory(siteDir, false)
  // finalize()'s rejection must reach the same 'error' listener callers
  // already attach — an unhandled rejection here would crash the whole
  // process (Node's default), not just fail this one request.
  archive.finalize().catch((error: unknown) => archive.emit('error', error))
  return archive
}

/**
 * Zips `siteDir` and pipes it into `destination`. Uses `stream.pipeline`
 * rather than `.pipe()` so an error on either side (a zip-time I/O failure,
 * or the destination closing early — e.g. a client aborting the download)
 * destroys both streams instead of leaving the archive reading files for a
 * destination nobody is listening to anymore.
 */
export async function streamWorkspaceZip(siteDir: string, destination: NodeJS.WritableStream): Promise<void> {
  const archive = createWorkspaceZipStream(siteDir)
  await pipeline(archive, destination)
}
