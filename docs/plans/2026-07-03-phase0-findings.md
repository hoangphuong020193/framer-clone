# Phase 0 Findings: Real Framer Site Spike

Spike target: `https://helloitsphane.framer.website` (user-owned, authorized). Captured 2026-07-03 via `curl` — no browser available this session (Playwright MCP tools disconnected). Raw fixtures saved under `docs/fixtures/real-framer-capture/`. Browser-dependent items (hover/click/cursor-follow empirical behavior, rendered-DOM link discovery) remain **unverified** — flagged below and carried forward as a follow-up, not a blocker for starting Phase 1-2.

## 1. HTTP-first feasibility — CONFIRMED, changes Phase 2/3 default

The site is fully server-side generated (`Server-Timing: ssg-status;desc="optimized"`, `Server: Framer/1a1b925`). A plain `curl` fetch of the initial document returns:

- The complete DOM tree, including all appear-effect markup and initial hidden states (see §2).
- All CSS **inlined** in `<style>` tags directly in the HTML (`data-framer-css-ssr-minified`) — there is no separate stylesheet asset to fetch. This simplifies Phase 4: no cross-origin CSS files to rewrite, only inline `<style>` content and inline `style=""` attributes.
- All script/chunk references as static `<link rel="modulepreload">` tags with literal absolute URLs — fully discoverable without executing JS.

**Decision: Phase 2 defaults to HTTP-first capture** (plain fetch + HTML/CSS parse) for the document and its statically-declared resources. A single lightweight browser pass per page is still needed for:
- Confirming lazy-mounted/scroll-triggered requests (unverified this session — no browser).
- SPA-rendered nav links not present as static `<a>` tags (unverified this session — no browser).

This is a scope reduction from "3-5 full browser contexts crawling everything," not an elimination of Playwright — browser use narrows to a discovery/verification role.

## 2. Appear-effect capture — CONFIRMED, even stronger than assumed

The original "Key Finding" (PLAN.md) hypothesized the hidden state might only exist via JS mutation after load. Evidence shows it's better than that: the hidden state is **baked directly into the server-rendered HTML**:

```html
<div class="framer-1g7xbpb" data-framer-appear-id="1g7xbpb" data-framer-cursor="1q5hk30"
     data-framer-name="Character" draggable="false" tabindex="0"
     style="will-change:transform;opacity:0.001;transform:translateX(-50%) translateY(150px);...">
```

`data-framer-appear-id`, `data-framer-appear-animation`, and the inline `opacity:0.001` + `blur(10px)` + `transform` are all present in the raw `curl` response — no browser execution needed to see the pre-animation state. This validates raw-response capture (never live-DOM serialization) even more directly than the design doc assumed: the risk isn't "will opacity:0 be missing from a raw fetch" (it won't be), it's "will a scrolled/interacted-with **live browser tab** have already flipped some elements to opacity:1 before a naive save freezes that as the new baseline" — which raw capture avoids entirely.

## 3. Cursor-follow effect — confirmed present, mechanism identified

`data-framer-cursor="1q5hk30"` on the same "Character" element above is a concrete real example of the cursor-follow/magnetic-effect category. The ID maps to cursor-behavior config consumed by the main JS bundle at runtime. Global cursor CSS rules also present inline: `[data-framer-cursor=pointer]{cursor:pointer}`, `[data-framer-cursor=grab]{cursor:grab}`. As long as the attribute and the bundle are captured verbatim (both confirmed to survive raw capture), the mechanism should work — **empirical browser confirmation of actual cursor-tracking behavior is still outstanding** (no browser this session).

## 4. Dynamic `import()` — relative paths, not runtime string concatenation (simplifies Phase 4)

Inspected the main bundle (`script_main.BjiuXvIp.mjs`, 34.5KB). All internal chunk-to-chunk dynamic imports use **relative** template-literal paths resolved against the importing module's own URL:

```js
page: P(()=>import(`./QYopomCzocaBYoSvn0y0KvmHEqnTsAYR_b-w49Yo6C4.BhfQ-q-U.mjs`))
notFoundPage: P(()=>import(`./SitesNotFoundPage.js@1.4.QJOGEHlE.mjs`))
```

**Decision: Phase 4 does not need the full-origin literal-string-replacement approach for JS-to-JS chunk references** — ES module relative imports resolve automatically as long as the exact `sites/{siteId}/` directory structure is mirrored locally (which the origin-mirrored layout already does for other reasons). The **service-worker fallback stays in the plan** but is downgraded from "likely needed" to "defensive fallback" — the one non-relative reference found was `import(\`https://framer.com/edit/init.mjs\`)`, which is the editor-bridge script Phase 4 already plans to strip/no-op (it's editor-context-only, not part of published-site runtime behavior).

**Rewriting is still required** for: absolute asset URLs (`https://framerusercontent.com/images/...`), and the analytics script (`https://events.framer.com/script?v=2`, confirmed present — strip per Phase 4).

## 5. Sitemap coverage — CONFIRMED, validates sitemap-first discovery

`sitemap.xml` exists and lists all 7 pages, including CMS-style detail pages that a static `<a href>` scan might miss if they're rendered client-side:

```xml
/, /contact, /work,
/projects/project-airplane, /projects/project-train, /projects/project-boat, /projects/project-car
```

`robots.txt` allows all and points to the sitemap. **Decision confirmed: sitemap-first seeding (Phase 3) is viable as designed** for this site's CMS-collection pattern (`/projects/*`).

## 6. Cross-page asset dedup — CONFIRMED, high value

All three pages tested (`/`, `/contact`, `/projects/project-airplane`) reference the **identical** main bundle file (`script_main.BjiuXvIp.mjs`) and share identical nav markup (`framer-OoLyG` class, 3 responsive variants, byte-identical across pages). **Confirms Phase 3's cross-page asset dedup is high-value** (avoids re-downloading the same ~35KB+ bundle and shared chunks per page) and **Phase 9's structural-similarity matching has a real, concrete target** (the nav component) to validate against.

## 7. Image asset identity — new nuance for Phase 4

Images are served with resize-hint query strings that affect the actual returned bytes: `https://framerusercontent.com/images/o85....png?width=1024&height=1426`. Different width/height query combinations for the *same* base image return *different* resized files.

**Addition to Phase 4:** asset identity for local mirroring/dedup must include the full query string, not just the path — stripping query params before mirroring would silently serve the wrong resolution or collide two different resized variants onto one filename.

## 8. Per-page fetch timing — informs default timeout

Measured `curl` fetch time for all 7 sitemap pages against this CDN-cached site:

| Page | Time |
|---|---|
| `/` | 0.66s |
| `/contact` | 0.49s |
| `/work` | 0.48s |
| `/projects/project-airplane` | 0.48s |
| `/projects/project-train` | 0.51s |
| `/projects/project-boat` | 0.53s |
| `/projects/project-car` | 0.83s |

Average ~0.57s/page for HTTP-first document fetch on a cached Framer CDN response. This is a **best-case floor** (no browser overhead, no asset downloads, small site). Not sufficient alone to lock in a production concurrency/timeout default — that still needs a real browser-based multi-page run (unverified this session) against a larger site with heavier media. Rough starting point for Phase 3: per-page timeout in the 10-15s range (generous headroom over this floor for asset-heavy pages), wall-clock crawl timeout not yet empirically set — revisit once browser-based capture exists.

## 9. SEO/meta tags — confirmed pass through by construction

`<meta name="description">`, `og:title`, `og:description`, `twitter:title`, `og:url` all present in the raw HTML — no special handling needed beyond normal asset/HTML capture, confirming the "best-effort, captured through normal capture" checklist status.

## Open items — not yet verified (no browser this session)

- Hover-state and click-triggered interaction behavior (visual/functional confirmation).
- Actual cursor-follow tracking behavior at runtime.
- Rendered-DOM link extraction surfacing any SPA-only nav links beyond the sitemap.
- Lazy-mounted/scroll-triggered request discovery.
- Concurrency (3 vs 5) and wall-clock timeout tuning against a real multi-page browser-driven crawl.
- OSS building block check (`website-scraper`, `SingleFile` internals) — not performed this session; recommend a quick `npm view` / repo-read pass before Phase 2 starts.

**Recommendation:** reconnect Playwright MCP (or do a manual pass) before Phase 2 implementation begins, specifically to confirm items 1-4 above. Everything else in this findings doc is confirmed from real response data and safe to build against now.

## Fixture

Real captured pages + main bundle saved at `docs/fixtures/real-framer-capture/` (checked-in per Phase 0's requirement — this is the only automated coverage of "Framer's runtime markup/attributes change across versions," the plan's #1 risk). Contents:
- `pages/index.html`, `pages/contact.html`, `pages/projects-project-airplane.html` — raw SSR HTML as served.
- `script_main.BjiuXvIp.mjs` — the shared main JS bundle.
