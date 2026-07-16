import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePreviewCandidates } from './previewPath.function.js'

const siteDir = path.resolve('/tmp/site')

describe('resolvePreviewCandidates', () => {
  it('resolves the root path to index.html', () => {
    expect(resolvePreviewCandidates(siteDir, '/')).toEqual([path.join(siteDir, 'index.html')])
  })

  it('resolves an extensionless path to itself, a directory index, and a .html sibling', () => {
    expect(resolvePreviewCandidates(siteDir, '/about')).toEqual([
      path.join(siteDir, 'about'),
      path.join(siteDir, 'about', 'index.html'),
      path.join(siteDir, 'about.html'),
    ])
  })

  it('strips query and hash before resolving, keeping the file the first candidate', () => {
    expect(resolvePreviewCandidates(siteDir, '/x.png?w=100#frag')).toEqual([
      path.join(siteDir, 'x.png'),
      path.join(siteDir, 'x.png', 'index.html'),
      path.join(siteDir, 'x.png.html'),
    ])
  })

  it('drops candidates that escape the workspace via traversal', () => {
    expect(resolvePreviewCandidates(siteDir, '/../secret.txt')).toEqual([])
  })

  it('returns [] when the path cannot be URL-decoded', () => {
    expect(resolvePreviewCandidates(siteDir, '/%')).toEqual([])
  })
})
