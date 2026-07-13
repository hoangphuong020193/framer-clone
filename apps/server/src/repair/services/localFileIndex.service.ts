import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Recursively lists every file under `rootDir`, returning POSIX-style paths
 * relative to it (matching the format `urlToLocalPath` produces) — the set
 * repair checks against to decide whether a given URL was actually captured.
 */
export async function buildCapturedPathIndex(rootDir: string): Promise<Set<string>> {
  const result = new Set<string>()
  await walk(rootDir, rootDir, result)
  return result
}

async function walk(rootDir: string, currentDir: string, result: Set<string>): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      await walk(rootDir, fullPath, result)
    } else if (entry.isFile()) {
      const relative = path.relative(rootDir, fullPath).split(path.sep).join('/')
      result.add(relative)
    }
  }
}
