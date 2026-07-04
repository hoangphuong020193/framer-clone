import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface WriteResult {
  localPath: string
  wasNew: boolean
}

/**
 * Persists captured resource bodies under a site workspace directory with
 * write-once semantics, keyed by canonical URL — so a resource referenced
 * from multiple pages during a crawl (Phase 3) is only fetched/written once.
 * Safe to call concurrently for the same or colliding URLs (see
 * `writeIfNew`'s synchronous reservation step).
 *
 * Also guards against case-insensitive filename collisions: Windows/macOS
 * filesystems are case-insensitive by default, so two different resources
 * whose sanitized paths differ only by case would otherwise silently
 * overwrite each other.
 */
export class ResourceStore {
  private readonly byUrl = new Map<string, string>()
  private readonly claimedByLowerPath = new Map<string, string>()

  constructor(private readonly siteRootDir: string) {}

  has(canonicalUrl: string): boolean {
    return this.byUrl.has(canonicalUrl)
  }

  async writeIfNew(canonicalUrl: string, desiredLocalPath: string, body: Buffer): Promise<WriteResult> {
    const existing = this.byUrl.get(canonicalUrl)
    if (existing) return { localPath: existing, wasNew: false }

    // Reserve synchronously — no `await` between the check above and the
    // claims below — so two concurrent calls for the same URL, or for two
    // different URLs that collide on the same case-folded path, can't both
    // observe "unclaimed" before either claim is recorded. Without this,
    // both would resolve to the same local path and one write would
    // silently clobber the other's bytes on disk.
    const localPath = this.resolveCollision(canonicalUrl, desiredLocalPath)
    const fullPath = this.resolveWithinRoot(localPath)
    this.byUrl.set(canonicalUrl, localPath)
    this.claimedByLowerPath.set(localPath.toLowerCase(), canonicalUrl)

    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, body)
    } catch (err) {
      this.byUrl.delete(canonicalUrl)
      this.claimedByLowerPath.delete(localPath.toLowerCase())
      throw err
    }

    return { localPath, wasNew: true }
  }

  /**
   * Defense-in-depth: `urlToLocalPath` is responsible for producing a
   * traversal-safe path, but a store that writes wherever it's told is one
   * bug away from an arbitrary file write. Refuse anything that resolves
   * outside `siteRootDir`, regardless of how `localPath` was derived.
   */
  private resolveWithinRoot(localPath: string): string {
    const root = path.resolve(this.siteRootDir)
    const full = path.resolve(root, localPath)
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Refusing to write outside site root: ${localPath}`)
    }
    return full
  }

  private resolveCollision(canonicalUrl: string, desiredLocalPath: string): string {
    const lowerKey = desiredLocalPath.toLowerCase()
    const claimant = this.claimedByLowerPath.get(lowerKey)
    if (!claimant || claimant === canonicalUrl) return desiredLocalPath

    const hash = crypto.createHash('sha1').update(canonicalUrl).digest('hex').slice(0, 6)
    const ext = path.extname(desiredLocalPath)
    const stem = ext ? desiredLocalPath.slice(0, -ext.length) : desiredLocalPath
    return `${stem}-${hash}${ext}`
  }
}
