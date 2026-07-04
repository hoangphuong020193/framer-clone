import { describe, expect, it } from 'vitest'
import { urlToLocalPath } from './urlPathMapping.js'

const SITE_ORIGIN = 'https://example.framer.website'

describe('urlToLocalPath', () => {
  it('maps the site root to index.html', () => {
    expect(urlToLocalPath(new URL(SITE_ORIGIN + '/'), SITE_ORIGIN)).toBe('index.html')
  })

  it('maps a same-origin extensionless page path to <path>/index.html', () => {
    expect(urlToLocalPath(new URL(SITE_ORIGIN + '/about'), SITE_ORIGIN)).toBe('about/index.html')
  })

  it('maps a nested same-origin CMS-style path correctly', () => {
    expect(urlToLocalPath(new URL(SITE_ORIGIN + '/projects/project-airplane'), SITE_ORIGIN)).toBe(
      'projects/project-airplane/index.html',
    )
  })

  it('keeps a same-origin asset with an extension at its own path', () => {
    expect(urlToLocalPath(new URL(SITE_ORIGIN + '/favicon.ico'), SITE_ORIGIN)).toBe('favicon.ico')
  })

  it('mirrors a cross-origin asset under a per-hostname subdirectory', () => {
    const url = new URL('https://framerusercontent.com/images/pic.png')
    expect(urlToLocalPath(url, SITE_ORIGIN)).toBe('framerusercontent.com/images/pic.png')
  })

  it('folds the query string into the filename so different resize variants do not collide', () => {
    const a = new URL('https://framerusercontent.com/images/pic.png?width=100&height=50')
    const b = new URL('https://framerusercontent.com/images/pic.png?width=800&height=400')
    const pathA = urlToLocalPath(a, SITE_ORIGIN)
    const pathB = urlToLocalPath(b, SITE_ORIGIN)
    expect(pathA).not.toBe(pathB)
    expect(pathA.startsWith('framerusercontent.com/images/pic')).toBe(true)
  })

  it('produces the same path for the same URL twice (deterministic)', () => {
    const url = new URL('https://framerusercontent.com/images/pic.png?width=100')
    expect(urlToLocalPath(url, SITE_ORIGIN)).toBe(urlToLocalPath(url, SITE_ORIGIN))
  })

  it('sanitizes Windows-invalid characters in path segments', () => {
    const url = new URL(SITE_ORIGIN + '/' + encodeURIComponent('weird:name?*.html'))
    const result = urlToLocalPath(url, SITE_ORIGIN)
    expect(result).not.toMatch(/[<>:"|?*]/)
  })

  it('prefixes Windows-reserved device names', () => {
    const url = new URL(SITE_ORIGIN + '/con')
    expect(urlToLocalPath(url, SITE_ORIGIN)).toBe('_con/index.html')
  })

  it('truncates very long path segments with a stable hash suffix', () => {
    const longName = 'a'.repeat(300) + '.png'
    const url = new URL(SITE_ORIGIN + '/' + longName)
    const result = urlToLocalPath(url, SITE_ORIGIN)
    const segments = result.split('/')
    expect(segments[0].length).toBeLessThanOrEqual(100)
    expect(segments[0]).toMatch(/-[0-9a-f]{8}\.png$/)
  })

  it('does not let a percent-encoded slash smuggled through a single segment escape the workspace root', () => {
    // The WHATWG URL parser leaves "%2f"/"%5c" undecoded specifically so a
    // single path segment can't smuggle in a new separator. Decoding a
    // segment ourselves (for readability/dedup) must not reintroduce one.
    const url = new URL(SITE_ORIGIN + '/..%2f..%2f..%2f..%2f..%2ftmp%2fpwned.txt')
    const result = urlToLocalPath(url, SITE_ORIGIN)
    expect(result).not.toContain('/')
    expect(result.split(/[\\/]/)).not.toContain('..')
  })

  it('does not let a percent-encoded backslash smuggle in a Windows-style separator', () => {
    const url = new URL(SITE_ORIGIN + '/..%5c..%5c..%5cwindows%5csystem32')
    const result = urlToLocalPath(url, SITE_ORIGIN)
    expect(result).not.toMatch(/\\/)
  })
})
