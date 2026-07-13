import { describe, expect, it } from 'vitest'
import { repairHtml } from './repairHtml.function.js'

const SITE_ORIGIN = 'https://example.framer.website'
const BASE_URL = SITE_ORIGIN + '/'

describe('repairHtml', () => {
  it('rewrites a captured cross-origin image to its mirrored local path', () => {
    const html = `<img src="https://framerusercontent.com/images/pic.png">`
    const isCaptured = (p: string) => p === 'framerusercontent.com/images/pic.png'
    const result = repairHtml(html, { baseUrl: BASE_URL, siteOrigin: SITE_ORIGIN, isCaptured })
    expect(result).toContain('src="/framerusercontent.com/images/pic.png"')
  })

  it('leaves an uncaptured resource untouched (graceful degradation)', () => {
    const html = `<img src="https://framerusercontent.com/images/pic.png">`
    const result = repairHtml(html, { baseUrl: BASE_URL, siteOrigin: SITE_ORIGIN, isCaptured: () => false })
    expect(result).toContain('src="https://framerusercontent.com/images/pic.png"')
  })

  it('rewrites srcset candidates that were captured, preserving descriptors', () => {
    const html = `<img srcset="https://framerusercontent.com/a.png 1x, https://framerusercontent.com/b.png 2x">`
    const isCaptured = (p: string) => p === 'framerusercontent.com/a.png'
    const result = repairHtml(html, { baseUrl: BASE_URL, siteOrigin: SITE_ORIGIN, isCaptured })
    expect(result).toContain('/framerusercontent.com/a.png 1x')
    expect(result).toContain('https://framerusercontent.com/b.png 2x')
  })

  it('rewrites a same-origin link to a clean root-relative path when the page was captured', () => {
    const html = `<a href="${SITE_ORIGIN}/about">About</a>`
    const isCaptured = (p: string) => p === 'about/index.html'
    const result = repairHtml(html, { baseUrl: BASE_URL, siteOrigin: SITE_ORIGIN, isCaptured })
    expect(result).toContain('href="/about"')
  })

  it('leaves a same-origin link untouched when that page was not captured (partial crawl)', () => {
    const html = `<a href="${SITE_ORIGIN}/skipped">Skipped</a>`
    const result = repairHtml(html, { baseUrl: BASE_URL, siteOrigin: SITE_ORIGIN, isCaptured: () => false })
    expect(result).toContain(`href="${SITE_ORIGIN}/skipped"`)
  })

  it('leaves a cross-origin link untouched', () => {
    const html = `<a href="https://external.example.com/">External</a>`
    const result = repairHtml(html, { baseUrl: BASE_URL, siteOrigin: SITE_ORIGIN, isCaptured: () => true })
    expect(result).toContain('href="https://external.example.com/"')
  })

  it('rewrites url() references inside inline <style> blocks', () => {
    const html = `<style>.hero{background-image:url("https://framerusercontent.com/bg.jpg")}</style>`
    const isCaptured = (p: string) => p === 'framerusercontent.com/bg.jpg'
    const result = repairHtml(html, { baseUrl: BASE_URL, siteOrigin: SITE_ORIGIN, isCaptured })
    expect(result).toContain('url("/framerusercontent.com/bg.jpg")')
  })

  it('rewrites url() references inside inline style="" attributes', () => {
    const html = `<div style="background-image:url(https://framerusercontent.com/bg.png)"></div>`
    const isCaptured = (p: string) => p === 'framerusercontent.com/bg.png'
    const result = repairHtml(html, { baseUrl: BASE_URL, siteOrigin: SITE_ORIGIN, isCaptured })
    expect(result).toContain('url(/framerusercontent.com/bg.png)')
  })

  it("preserves an appear-effect element's hidden state untouched", () => {
    const html = `<div data-framer-appear-id="abc" style="opacity:0.001;transform:translateY(50px)"></div>`
    const result = repairHtml(html, { baseUrl: BASE_URL, siteOrigin: SITE_ORIGIN, isCaptured: () => false })
    expect(result).toContain('opacity:0.001')
    expect(result).toContain('data-framer-appear-id="abc"')
  })

  it('strips a known non-functional analytics script', () => {
    const html = `<script src="https://events.framer.com/script?v=2"></script><script src="/site-bundle.mjs"></script>`
    const result = repairHtml(html, { baseUrl: BASE_URL, siteOrigin: SITE_ORIGIN, isCaptured: () => false })
    expect(result).not.toContain('events.framer.com')
    expect(result).toContain('/site-bundle.mjs')
  })

  it('ignores data: URIs without throwing', () => {
    const html = `<img src="data:image/png;base64,AAAA">`
    expect(() =>
      repairHtml(html, { baseUrl: BASE_URL, siteOrigin: SITE_ORIGIN, isCaptured: () => true }),
    ).not.toThrow()
  })
})
