import { describe, expect, it } from 'vitest'
import { normalizePageUrl } from './normalizeUrl.function.js'

const SITE_ORIGIN = 'https://example.framer.website'

describe('normalizePageUrl', () => {
  it('returns the URL unchanged when already normalized', () => {
    expect(normalizePageUrl(SITE_ORIGIN + '/about', SITE_ORIGIN)).toBe(SITE_ORIGIN + '/about')
  })

  it('strips a trailing slash on non-root paths', () => {
    expect(normalizePageUrl(SITE_ORIGIN + '/about/', SITE_ORIGIN)).toBe(SITE_ORIGIN + '/about')
  })

  it('keeps the root path as-is (does not strip the only slash)', () => {
    expect(normalizePageUrl(SITE_ORIGIN + '/', SITE_ORIGIN)).toBe(SITE_ORIGIN + '/')
  })

  it('strips the fragment', () => {
    expect(normalizePageUrl(SITE_ORIGIN + '/about#team', SITE_ORIGIN)).toBe(SITE_ORIGIN + '/about')
  })

  it('dedupes a trailing-slash variant and a fragment variant to the same value', () => {
    const a = normalizePageUrl(SITE_ORIGIN + '/about/', SITE_ORIGIN)
    const b = normalizePageUrl(SITE_ORIGIN + '/about#contact', SITE_ORIGIN)
    expect(a).toBe(b)
  })

  it('returns null for a cross-origin URL', () => {
    expect(normalizePageUrl('https://external.example.com/about', SITE_ORIGIN)).toBeNull()
  })

  it('returns null for a non-http(s) protocol', () => {
    expect(normalizePageUrl('mailto:hi@example.com', SITE_ORIGIN)).toBeNull()
  })

  it('returns null for an invalid URL', () => {
    expect(normalizePageUrl('not a url', SITE_ORIGIN)).toBeNull()
  })
})
