import { describe, expect, it } from 'vitest'
import { parseCaptureUrl } from './parseCaptureUrl.function.js'

describe('parseCaptureUrl', () => {
  it('parses a valid https url', () => {
    const result = parseCaptureUrl({ url: 'https://example.com/' })
    expect(result?.toString()).toBe('https://example.com/')
  })

  it('parses a valid http url', () => {
    const result = parseCaptureUrl({ url: 'http://example.com/' })
    expect(result?.toString()).toBe('http://example.com/')
  })

  it('returns null for a non-http(s) protocol', () => {
    expect(parseCaptureUrl({ url: 'ftp://example.com/' })).toBeNull()
  })

  it('returns null when the url field is missing', () => {
    expect(parseCaptureUrl({})).toBeNull()
  })

  it('returns null when the url field is not a string', () => {
    expect(parseCaptureUrl({ url: 123 })).toBeNull()
  })

  it('returns null for a malformed url string', () => {
    expect(parseCaptureUrl({ url: 'not a url' })).toBeNull()
  })

  it('returns null for a null or non-object body', () => {
    expect(parseCaptureUrl(null)).toBeNull()
    expect(parseCaptureUrl('a string')).toBeNull()
    expect(parseCaptureUrl(undefined)).toBeNull()
  })
})
