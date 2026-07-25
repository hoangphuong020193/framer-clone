import { describe, expect, it } from 'vitest'
import { buildDownloadFilename } from './downloadFilename.function.js'

describe('buildDownloadFilename', () => {
  it('derives a filename from the entry URL hostname', () => {
    expect(buildDownloadFilename('https://example.framer.website/about')).toBe('example.framer.website.zip')
  })

  it('ignores port, path, and query string', () => {
    expect(buildDownloadFilename('https://example.com:8080/path?query=1')).toBe('example.com.zip')
  })

  it('sanitizes characters outside the safe filename set', () => {
    expect(buildDownloadFilename('https://xn--exmple-cua.com/')).toBe('xn--exmple-cua.com.zip')
  })

  it('falls back to the default name when entryUrl is undefined', () => {
    expect(buildDownloadFilename(undefined)).toBe('capture.zip')
  })

  it('falls back to the default name when entryUrl is unparsable', () => {
    expect(buildDownloadFilename('not a url')).toBe('capture.zip')
  })
})
