import { describe, expect, it } from 'vitest'
import { parseCaptureMode } from './parseCaptureMode.function.js'

describe('parseCaptureMode', () => {
  it('returns single-page only for the explicit single-page value', () => {
    expect(parseCaptureMode({ mode: 'single-page' })).toBe('single-page')
  })

  it('returns whole-site for the explicit whole-site value', () => {
    expect(parseCaptureMode({ mode: 'whole-site' })).toBe('whole-site')
  })

  it('defaults to whole-site when mode is missing', () => {
    expect(parseCaptureMode({ url: 'https://example.com' })).toBe('whole-site')
  })

  it('degrades an unknown/garbage mode to whole-site', () => {
    expect(parseCaptureMode({ mode: 'everything' })).toBe('whole-site')
    expect(parseCaptureMode({ mode: 42 })).toBe('whole-site')
  })

  it('returns whole-site for a null or non-object body', () => {
    expect(parseCaptureMode(null)).toBe('whole-site')
    expect(parseCaptureMode('single-page')).toBe('whole-site')
  })
})
