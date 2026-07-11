import { describe, expect, it } from 'vitest'
import { scanHtmlForResources } from './htmlResourceScan.function.js'

const BASE_URL = 'https://example.framer.website/'

describe('scanHtmlForResources', () => {
  it('finds an image src and resolves it against the base URL', () => {
    const html = `<img src="/images/pic.png">`
    expect(scanHtmlForResources(html, BASE_URL)).toEqual([
      { absoluteUrl: 'https://example.framer.website/images/pic.png', kind: 'image' },
    ])
  })

  it('finds all srcset candidates', () => {
    const html = `<img srcset="/a.png 1x, /b.png 2x">`
    const urls = scanHtmlForResources(html, BASE_URL).map((f) => f.absoluteUrl)
    expect(urls).toContain('https://example.framer.website/a.png')
    expect(urls).toContain('https://example.framer.website/b.png')
  })

  it('finds modulepreload script chunks', () => {
    const html = `<link rel="modulepreload" href="https://framerusercontent.com/sites/x/react.mjs">`
    expect(scanHtmlForResources(html, BASE_URL)).toEqual([
      { absoluteUrl: 'https://framerusercontent.com/sites/x/react.mjs', kind: 'script' },
    ])
  })

  it('finds a stylesheet link', () => {
    const html = `<link rel="stylesheet" href="/styles.css">`
    expect(scanHtmlForResources(html, BASE_URL)).toEqual([
      { absoluteUrl: 'https://example.framer.website/styles.css', kind: 'stylesheet-link' },
    ])
  })

  it('finds url() references inside inline <style> blocks', () => {
    const html = `<style>.hero{background-image:url("/bg.jpg")}</style>`
    expect(scanHtmlForResources(html, BASE_URL)).toEqual([
      { absoluteUrl: 'https://example.framer.website/bg.jpg', kind: 'image' },
    ])
  })

  it('finds url() references inside inline style="" attributes', () => {
    const html = `<div style="background-image:url(/inline-bg.png)"></div>`
    expect(scanHtmlForResources(html, BASE_URL)).toEqual([
      { absoluteUrl: 'https://example.framer.website/inline-bg.png', kind: 'image' },
    ])
  })

  it('ignores data: URIs', () => {
    const html = `<img src="data:image/png;base64,AAAA">`
    expect(scanHtmlForResources(html, BASE_URL)).toEqual([])
  })

  it('deduplicates the same URL referenced multiple times', () => {
    const html = `<img src="/pic.png"><img src="/pic.png">`
    expect(scanHtmlForResources(html, BASE_URL)).toHaveLength(1)
  })

  it('preserves an appear-effect element untouched while still finding its sibling image', () => {
    const html = `
      <div data-framer-appear-id="abc" style="opacity:0.001;transform:translateY(50px)"></div>
      <img src="/hero.png">
    `
    const found = scanHtmlForResources(html, BASE_URL)
    expect(found.map((f) => f.absoluteUrl)).toEqual(['https://example.framer.website/hero.png'])
  })

  it('skips malformed URLs without throwing', () => {
    const html = `<img src="http://[invalid">`
    expect(() => scanHtmlForResources(html, BASE_URL)).not.toThrow()
  })
})
