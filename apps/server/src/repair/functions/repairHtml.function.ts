import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'
import { NON_FUNCTIONAL_SCRIPT_HOST_PATTERNS, type IsCapturedFn, type RepairHtmlOptions } from '../models/repair.model.js'
import { resolveCapturedAssetPath, resolveCapturedLinkPath } from './urlRewrite.function.js'

const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g

function toAbsolute(raw: string | undefined, baseUrl: string): string | null {
  if (!raw || raw.startsWith('data:')) return null
  try {
    return new URL(raw, baseUrl).toString()
  } catch {
    return null
  }
}

function rewriteCssUrls(cssText: string, baseUrl: string, siteOrigin: string, isCaptured: IsCapturedFn): string {
  return cssText.replace(CSS_URL_PATTERN, (full, quote: string, raw: string) => {
    const absolute = toAbsolute(raw, baseUrl)
    if (!absolute) return full
    const target = resolveCapturedAssetPath(absolute, siteOrigin, isCaptured)
    return target ? `url(${quote}${target}${quote})` : full
  })
}

function rewriteAssetAttr(
  $: cheerio.CheerioAPI,
  el: AnyNode,
  attr: string,
  baseUrl: string,
  siteOrigin: string,
  isCaptured: IsCapturedFn,
): void {
  const absolute = toAbsolute($(el).attr(attr), baseUrl)
  if (!absolute) return
  const target = resolveCapturedAssetPath(absolute, siteOrigin, isCaptured)
  if (target) $(el).attr(attr, target)
}

function rewriteSrcset(
  $: cheerio.CheerioAPI,
  el: AnyNode,
  baseUrl: string,
  siteOrigin: string,
  isCaptured: IsCapturedFn,
): void {
  const raw = $(el).attr('srcset')
  if (!raw) return
  const rewritten = raw
    .split(',')
    .map((part) => {
      const trimmed = part.trim()
      const [candidate, descriptor] = trimmed.split(/\s+/, 2)
      const absolute = toAbsolute(candidate, baseUrl)
      if (!absolute) return trimmed
      const target = resolveCapturedAssetPath(absolute, siteOrigin, isCaptured)
      if (!target) return trimmed
      return descriptor ? `${target} ${descriptor}` : target
    })
    .join(', ')
  $(el).attr('srcset', rewritten)
}

function rewriteLinks($: cheerio.CheerioAPI, baseUrl: string, siteOrigin: string, isCaptured: IsCapturedFn): void {
  $('a[href]').each((_, el) => {
    const absolute = toAbsolute($(el).attr('href'), baseUrl)
    if (!absolute) return
    const target = resolveCapturedLinkPath(absolute, siteOrigin, isCaptured)
    if (target) $(el).attr('href', target)
  })
}

function stripNonFunctionalScripts($: cheerio.CheerioAPI): void {
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src') ?? ''
    if (NON_FUNCTIONAL_SCRIPT_HOST_PATTERNS.some((pattern) => src.includes(pattern))) {
      $(el).remove()
    }
  })
}

/**
 * Rewrites a captured page's raw HTML so it works when served from the
 * local archive: absolute references to resources actually captured become
 * root-relative local paths, same-origin page links strip their origin, and
 * known non-functional (editor-bridge/analytics) scripts are removed.
 * Anything not captured is left untouched — a partial/timed-out crawl must
 * degrade gracefully, not produce broken local references.
 */
export function repairHtml(html: string, opts: RepairHtmlOptions): string {
  const { baseUrl, siteOrigin, isCaptured } = opts
  const $ = cheerio.load(html)

  $('img[src]').each((_, el) => rewriteAssetAttr($, el, 'src', baseUrl, siteOrigin, isCaptured))
  $('img[srcset], source[srcset]').each((_, el) => rewriteSrcset($, el, baseUrl, siteOrigin, isCaptured))
  $('script[src]').each((_, el) => rewriteAssetAttr($, el, 'src', baseUrl, siteOrigin, isCaptured))
  $('link[rel="modulepreload"][href]').each((_, el) => rewriteAssetAttr($, el, 'href', baseUrl, siteOrigin, isCaptured))
  $('link[rel="stylesheet"][href]').each((_, el) => rewriteAssetAttr($, el, 'href', baseUrl, siteOrigin, isCaptured))
  $('link[rel="icon"][href], link[rel="shortcut icon"][href], link[rel="apple-touch-icon"][href]').each((_, el) =>
    rewriteAssetAttr($, el, 'href', baseUrl, siteOrigin, isCaptured),
  )
  $('source[src]').each((_, el) => rewriteAssetAttr($, el, 'src', baseUrl, siteOrigin, isCaptured))
  $('video[poster]').each((_, el) => rewriteAssetAttr($, el, 'poster', baseUrl, siteOrigin, isCaptured))

  $('style').each((_, el) => {
    const text = $(el).html()
    if (text) $(el).text(rewriteCssUrls(text, baseUrl, siteOrigin, isCaptured))
  })
  $('[style]').each((_, el) => {
    const text = $(el).attr('style')
    if (text) $(el).attr('style', rewriteCssUrls(text, baseUrl, siteOrigin, isCaptured))
  })

  rewriteLinks($, baseUrl, siteOrigin, isCaptured)
  stripNonFunctionalScripts($)

  return $.html()
}
