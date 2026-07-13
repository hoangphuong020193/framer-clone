import { describe, expect, it } from 'vitest'
import { resolveCapturedAssetPath, resolveCapturedLinkPath } from './urlRewrite.function.js'

const SITE_ORIGIN = 'https://example.framer.website'

describe('resolveCapturedAssetPath', () => {
  it('resolves a captured cross-origin asset to its mirrored local path', () => {
    const isCaptured = (p: string) => p === 'framerusercontent.com/images/pic.png'
    expect(resolveCapturedAssetPath('https://framerusercontent.com/images/pic.png', SITE_ORIGIN, isCaptured)).toBe(
      '/framerusercontent.com/images/pic.png',
    )
  })

  it('returns null when the asset was not captured', () => {
    const isCaptured = () => false
    expect(resolveCapturedAssetPath('https://framerusercontent.com/images/pic.png', SITE_ORIGIN, isCaptured)).toBeNull()
  })

  it('returns null for an invalid URL rather than throwing', () => {
    const isCaptured = () => true
    expect(resolveCapturedAssetPath('not a url', SITE_ORIGIN, isCaptured)).toBeNull()
  })
})

describe('resolveCapturedLinkPath', () => {
  it('resolves a captured same-origin link to a clean root-relative request path', () => {
    const isCaptured = (p: string) => p === 'about/index.html'
    expect(resolveCapturedLinkPath(SITE_ORIGIN + '/about', SITE_ORIGIN, isCaptured)).toBe('/about')
  })

  it('preserves query string and hash on the rewritten link', () => {
    const isCaptured = () => true
    expect(resolveCapturedLinkPath(SITE_ORIGIN + '/about?x=1#top', SITE_ORIGIN, isCaptured)).toBe('/about?x=1#top')
  })

  it('returns null for a cross-origin link (not this site\'s own pages)', () => {
    const isCaptured = () => true
    expect(resolveCapturedLinkPath('https://external.example.com/', SITE_ORIGIN, isCaptured)).toBeNull()
  })

  it('returns null when the linked page was not captured', () => {
    const isCaptured = () => false
    expect(resolveCapturedLinkPath(SITE_ORIGIN + '/skipped', SITE_ORIGIN, isCaptured)).toBeNull()
  })

  it('returns null for an invalid URL rather than throwing', () => {
    const isCaptured = () => true
    expect(resolveCapturedLinkPath('not a url', SITE_ORIGIN, isCaptured)).toBeNull()
  })
})
