import { describe, expect, it } from 'vitest'
import { rewritePreviewHtml } from './previewHtmlRewrite.function.js'

const BASE = '/api/capture/cap-1/preview'

describe('rewritePreviewHtml', () => {
  it('prefixes root-relative src and href with the preview base', () => {
    const html = '<html><body><img src="/framerusercontent.com/x.png"><a href="/about">About</a></body></html>'
    const out = rewritePreviewHtml(html, BASE)

    expect(out).toContain(`src="${BASE}/framerusercontent.com/x.png"`)
    expect(out).toContain(`href="${BASE}/about"`)
  })

  it('leaves absolute, protocol-relative, fragment, and data URLs untouched', () => {
    const html =
      '<html><body>' +
      '<img src="https://cdn.example.com/a.png">' +
      '<script src="//cdn.example.com/b.js"></script>' +
      '<a href="#top">Top</a>' +
      '<img src="data:image/png;base64,AAAA">' +
      '</body></html>'
    const out = rewritePreviewHtml(html, BASE)

    expect(out).toContain('src="https://cdn.example.com/a.png"')
    expect(out).toContain('src="//cdn.example.com/b.js"')
    expect(out).toContain('href="#top"')
    expect(out).toContain('src="data:image/png;base64,AAAA"')
    expect(out).not.toContain(`${BASE}/cdn.example.com`)
  })

  it('prefixes each root-relative candidate in a srcset', () => {
    const html = '<html><body><img srcset="/a.png 1x, /b.png 2x"></body></html>'
    const out = rewritePreviewHtml(html, BASE)

    expect(out).toContain(`${BASE}/a.png 1x`)
    expect(out).toContain(`${BASE}/b.png 2x`)
  })

  it('prefixes url(/...) references inside inline styles and <style> blocks', () => {
    const html =
      '<html><head><style>.hero{background:url(/framerusercontent.com/bg.jpg)}</style></head>' +
      '<body><div style="background:url(\'/framerusercontent.com/inline.jpg\')"></div></body></html>'
    const out = rewritePreviewHtml(html, BASE)

    expect(out).toContain(`url(${BASE}/framerusercontent.com/bg.jpg)`)
    expect(out).toContain(`${BASE}/framerusercontent.com/inline.jpg`)
  })
})
