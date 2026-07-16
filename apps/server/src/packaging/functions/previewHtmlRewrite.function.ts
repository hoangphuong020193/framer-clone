import { load } from 'cheerio'

/**
 * The repair pass rewrites captured URLs to root-relative paths (`/about`,
 * `/framerusercontent.com/x.png`) so they resolve at the archive root. When the
 * same workspace is previewed under a path prefix (`/api/capture/:id/preview`),
 * those root-relative URLs would escape the prefix and 404. This re-prefixes
 * every root-relative URL reference in the served HTML with `basePath` so the
 * preview resolves in-place — leaving absolute (`https://`, `//`), fragment,
 * `data:`, and already-relative URLs untouched.
 */
export function rewritePreviewHtml(html: string, basePath: string): string {
  const $ = load(html)

  const prefixAttr = (selector: string, attr: string): void => {
    $(selector).each((_, el) => {
      const value = $(el).attr(attr)
      if (value !== undefined) $(el).attr(attr, prefixRootRelative(value, basePath))
    })
  }

  prefixAttr('[src]', 'src')
  prefixAttr('[href]', 'href')

  $('[srcset]').each((_, el) => {
    const value = $(el).attr('srcset')
    if (value !== undefined) $(el).attr('srcset', prefixSrcset(value, basePath))
  })

  $('[style]').each((_, el) => {
    const value = $(el).attr('style')
    if (value !== undefined) $(el).attr('style', prefixCssUrls(value, basePath))
  })

  $('style').each((_, el) => {
    $(el).text(prefixCssUrls($(el).text(), basePath))
  })

  return $.html()
}

/** A single URL is root-relative when it starts with one slash (not `//`, which is protocol-relative). */
function prefixRootRelative(url: string, basePath: string): string {
  return url.startsWith('/') && !url.startsWith('//') ? basePath + url : url
}

function prefixSrcset(value: string, basePath: string): string {
  return value
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim()
      if (trimmed === '') return candidate
      const [url, ...descriptor] = trimmed.split(/\s+/)
      return [prefixRootRelative(url, basePath), ...descriptor].join(' ')
    })
    .join(', ')
}

function prefixCssUrls(css: string, basePath: string): string {
  return css.replace(/url\(\s*(['"]?)(\/[^'")]*)\1\s*\)/g, (match, quote: string, url: string) => {
    if (url.startsWith('//')) return match
    return `url(${quote}${basePath}${url}${quote})`
  })
}
