# Implementation Plan: Full Framer Site Clone (Tier 1 Archival Snapshot + Tier 2 React Reconstruction)

> Formalizes the approved design in `docs/plans/2026-07-02-framer-full-clone-design.md`. Replaces the earlier animation-only-scoped version of this plan.

## Requirements Restatement

- A tool with a **textbox** to paste a Framer-published URL and a **button** to download it.
- **Tier 1 (primary):** produce a whole-site, browsable, offline archival snapshot — not just the entry page — with working scroll/appear animations, hover states, click-triggered interactions, and cursor-follow effects (the categories confirmed as must-work). CMS pages, embedded media/forms, and SEO metadata are captured best-effort, not specifically engineered for.
- **Tier 2 (secondary, on-demand):** from that same capture, produce a best-effort, editable React codebase — no re-crawl, no requirement for the user to own/have plugin access to the original Framer project.
- Whole-site crawl has **no artificial page cap** (same-origin only), with a wall-clock timeout as a safety net rather than a page limit.

## Key Finding from Research (unchanged from prior plan)

Framer's Appear Effect hides elements (`opacity:0` + transform offset) and animates them in via `IntersectionObserver`-driven runtime JS. A browser "Save As" freezes the **live, already-mutated DOM**, permanently breaking that state. The fix: capture the **original network response bodies** (HTML/CSS/JS/JSON as served), never the mutated DOM, and only rewrite what breaks when served from a new location (absolute→relative asset URLs, editor/analytics scripts that error offline).

## Architecture

```
User pastes URL ──▶ Tier 1: Whole-Site Capture ──▶ zip (archival snapshot, works standalone)
                                    │
                                    ▼ (same captured output, as input)
                          Tier 2: React Reconstruction (optional, run on demand)
                                    │
                                    ▼
                          separate downloadable React project
```

- **Tier 1:** Node/TS backend + Playwright. Discovery is **sitemap-first** (Framer auto-generates `sitemap.xml` incl. CMS pages — confirmed against a real site in Phase 0), supplemented by same-origin link extraction from the *rendered* DOM; BFS with cycle-safety dedupe on normalized URLs and a wall-clock timeout guardrail. Capture is **HTTP-first by default** (plain fetch + HTML/CSS parse — confirmed viable in Phase 0 since Framer sites are fully SSG), with a single lightweight Playwright pass per page for lazy-load/SPA-nav discovery only. Per-page: persist raw response bodies **plus a rendered-DOM snapshot** (archive uses only the raw bodies; the snapshot exists solely as Tier 2's input), then revert/repair (asset + internal-link URL rewrite, strip editor/analytics/live-reload scripts). SSRF guard sits in front of every fetch from day one.
- **Tier 2:** consumes Tier 1's output as input, no re-fetch — the mechanical converter reads the per-page rendered-DOM snapshots. Mechanical DOM→JSX core (deterministic, always runs) + optional toggleable AI refactor pass (best-effort, can fail without breaking the mechanical baseline).
- **Frontend:** React/Vite SPA. URL textbox + Download (Tier 1) → on completion, "Reconstruct as React" button appears (Tier 2), operating on the just-completed capture.
- **Runtime requirement:** a persistent Node process with a Chromium binary — not deployable as static/serverless. **Local-native is the primary target:** Node 20+ plus `npx playwright install chromium` (no Docker, no admin rights). Docker is an optional packaging step only for hosting on a Linux server later.

## Phases

### Phase 0 — Research & reuse spike *(no code)* — **partially complete**, see `docs/plans/2026-07-03-phase0-findings.md`
- ✅ Captured a real Framer site (`helloitsphane.framer.website`, user-owned) via raw HTTP fetch; inspected appear-effect/cursor markup and attribute naming. Fixture checked in at `docs/fixtures/real-framer-capture/`.
- ✅ **HTTP-first feasibility — CONFIRMED.** The site is fully SSG (`ssg-status: optimized`); a plain fetch returns complete DOM markup including all appear-effect hidden states, inline CSS, and static `modulepreload` script references. **Decision: Phase 2 defaults to HTTP-first capture**, with a single lightweight browser pass per page for lazy-load/SPA-nav discovery only — not full browser-per-page crawling.
- ✅ **`sitemap.xml` coverage — CONFIRMED.** Lists all 7 pages including CMS-style detail pages (`/projects/*`). Sitemap-first seeding (Phase 3) is viable as designed.
- ⚠️ Rendered-DOM link extraction (SPA-only nav links beyond the sitemap) — **not verified**, no browser available this session. Follow-up before Phase 3 implementation.
- ✅ **Dynamic `import()` behavior — CONFIRMED, changes Phase 4.** Chunk-to-chunk imports use relative paths resolved against the importing module's URL, not runtime string concatenation — mirroring the `sites/{siteId}/` directory structure resolves them for free. Full-origin literal-string rewriting is still needed for absolute asset URLs (images, analytics) and the query-string-inclusive asset identity (§7 of the findings doc). Service-worker fallback stays as a defensive measure, downgraded from "likely needed."
- ⚠️ Concurrency (3 vs 5) / wall-clock timeout — **not empirically set**; only a per-page HTTP fetch timing floor was measured (~0.57s avg on a small cached site). Needs a real browser-driven multi-page run before locking Phase 3 defaults. Rough starting point: 10-15s per-page timeout.
- ⚠️ Reusable OSS building blocks (`website-scraper`, `SingleFile` internals) — **not checked** this session; do before Phase 2 starts.
- ⚠️ Hover-state, click-interaction, and cursor-follow **runtime behavior** — markup/mechanism confirmed present (see findings §2-3), but empirical behavior confirmation needs a browser (unverified this session).
- ✅ Saved the real-Framer capture as a **checked-in test fixture** at `docs/fixtures/real-framer-capture/` (raw HTML for 3 pages + shared main JS bundle) — the only automated coverage of the #1 risk (markup drift across Framer versions).
- Output: `docs/plans/2026-07-03-phase0-findings.md` — locks in the Phase 2/4 decisions above; remaining ⚠️ items require reconnecting Playwright (or a manual pass) and should be closed out before or during Phase 2, not treated as a hard blocker to starting scaffolding (Phase 1).

### Phase 1 — Project scaffolding
- `apps/web` (Vite/React UI), `apps/server` (Express/Fastify + Playwright + archiver).
- **Keep the ops layer boring (MVP):** in-process job queue (`p-queue` or similar) — no Redis/BullMQ; SQLite or plain JSON files for job/capture metadata; streamed zip via `archiver`. Multi-instance infrastructure only when there's real deployment pressure.
- **Local-native setup is the deliverable:** `npm install` + `npx playwright install chromium` + `npm run dev` must be the complete bootstrap on Windows/macOS/Linux — no Docker dependency anywhere in the dev or run path.
- Dockerfile (using Playwright's base image with bundled Chromium) is **optional and deferred** — only needed if/when this is hosted as a public service on a Linux server. Size memory for ~300MB per browser context — RAM, not CPU, is the realistic concurrency limit.

### Phase 2 — Core single-page capture pipeline — **complete**
*(Confirmed by Phase 0 against a real Framer site — see `docs/plans/2026-07-03-phase0-findings.md` §1: HTTP-first is the default. Primary path is a plain fetch + HTML/CSS parse per page; a single Playwright pass per page/site handles discovery only — lazy-mounted chunks, interaction-triggered requests, SPA-rendered nav links not present as static `<a>` tags. SSRF guard, raw-body persistence, and edge-case handling below apply identically to both the fetch path and the Playwright discovery pass.)*

**Implemented** in `apps/server/src/capture/`: `ssrf.ts`, `urlPathMapping.ts`, `resourceStore.ts`, `fetchResource.ts`, `htmlResourceScan.ts`, `browserDiscovery.ts`, `capturePage.ts`. 62 Vitest tests passing (`npm run test -w apps/server`), including a real installed Chromium for the Playwright-discovery/integration tests.

An independent `code-reviewer` pass (adversarial, threat-modeled against "this tool fetches arbitrary attacker-influenced URLs server-side") found the items below; all were fixed before marking this phase done:
- **Path traversal (critical):** `urlPathMapping.ts` decoded a URL segment *after* the WHATWG parser had already left `%2f`/`%5c` un-decoded (specifically so a segment can't smuggle a separator) — reintroducing real `/`/`\` chars let a crafted resource URL escape `siteDir` entirely. Fixed by stripping separators post-decode, plus a defense-in-depth containment check in `ResourceStore` that refuses any write resolving outside `siteRootDir`.
- **Browser sub-request SSRF gap (critical):** `browserDiscovery.ts` only validated the top-level navigation URL; a page's own client-side `fetch`/XHR could still reach an internal address directly through Chromium's own network stack. Fixed with a `context.route('**/*', ...)` interceptor that re-validates every request the page makes, not just the initial navigation.
- **No response-size cap (high):** `fetchResource.ts` buffered arbitrary response bodies fully into memory. Fixed with a streamed byte-count cap (`MAX_RESPONSE_BYTES`, checked against both a declared `Content-Length` and the actual streamed total) — a real per-workspace budget is still Phase 3's job.
- **Browser context leak on error (high):** `discoverPage` only closed its Playwright context on the success path; an error mid-page left a full Chromium context (and its process/memory) running. Fixed with `try/finally`.
- **`ResourceStore` write race (medium):** collision bookkeeping was updated *after* the awaited file write, so two concurrent writes for the same or colliding URLs could both pass their checks before either claim was recorded, corrupting the "case-insensitive collision" guarantee needed once Phase 3's worker pool lands. Fixed by making the claim synchronous (no `await` between check and reservation), with concurrency regression tests.
- **Redirect-count off-by-one (low)** and **IPv6 tunneling-prefix gaps (low)** — NAT64/6to4/hex-form IPv4-mapped addresses could smuggle a blocked IPv4 target past the IPv6 literal check — both fixed with regression tests.

**Accepted, documented residual risk:** `page.goto`'s own initial DNS resolution and the `context.route` interceptor's re-resolution both happen outside Node's DNS-rebinding-safe dispatcher pinning (which only protects `fetchRaw`'s own connections) — a very-low-TTL DNS-rebind between validation and Chromium's actual connect is not fully closed for the browser-driven pass. The mitigation: every resource this pass observes is independently re-validated and re-fetched through the guarded `fetchRaw` path before anything is persisted, so a successful rebind here still can't get attacker-reachable bytes into the archive. See the docstring in `browserDiscovery.ts`.
- **SSRF guard built here, not deferred:** the moment this phase exists the server fetches arbitrary user-supplied URLs. Validate before any fetch — http(s)-only, resolve-then-check-IP (DNS-rebinding safe), block localhost/private ranges/link-local metadata endpoints. Ships with its unit tests (Phase 7 lists them); Phase 8 re-verifies rather than first builds.
- HTTP-first path: fetch the document, parse HTML/CSS to enumerate all statically-declared resources (images, `modulepreload` script chunks, inline-`<style>` references), and persist every resource's **original response body** to disk with a locally relative path.
- Save the **initial document response** as-is (raw bytes, not any parsed/re-serialized form) as that page's base HTML.
- Playwright discovery pass (single, lightweight — not full capture): navigate, wait for `networkidle`, auto-scroll once to trigger lazy-mounted requests, wait for a **second network-settle**, then diff its observed request list against the HTTP-first resource list — anything the fetch path missed gets fetched and persisted the same way. Extract same-origin links from the rendered DOM here too (feeds Phase 3).
- Handle response-body edge cases explicitly: fetch/`response.body()` fails on redirects (record the redirect mapping instead), and video/large media arrives via `206 Partial Content` range requests — detect and re-fetch those resources whole out-of-band, or mark them degraded in the capture report rather than saving a truncated file.
- **Per-page navigation/settle timeout** (independent of the whole-crawl wall clock) — `networkidle` can hang on pages with polling; a stuck page must not stall a worker indefinitely. Phase 0 measured a ~0.57s avg HTTP-first fetch floor on a small cached site — informs but doesn't fully set this (needs a browser-driven multi-page run first, see Phase 0 open items).
- Additionally snapshot the **rendered DOM** per page (post-settle, from the Playwright discovery pass), stored alongside the raw capture. Never used for the Tier 1 archive — it exists solely as Phase 9's input, and capturing it now (while the browser is already on the page) avoids Tier 2 needing to re-render.

### Phase 3 — Whole-site BFS crawl engine — **complete**
- **Sitemap-first discovery:** fetch `sitemap.xml` (Framer auto-generates it, including CMS pages) and seed the queue with every listed URL before crawling. This directly mitigates the "CMS pages not linked via `<a>` tags" risk and gives an upfront page total for real progress reporting ("14 of 87 pages") instead of an open-ended counter.
- Work queue seeded with sitemap URLs + the entry URL; worker pool of 3-5 workers — primarily HTTP fetchers (confirmed viable, Phase 0), each pairing a page with one lightweight Playwright discovery pass — pop URLs concurrently. Exact concurrency default still needs empirical tuning against a real browser-driven multi-page run (Phase 0 only measured an HTTP-fetch-only timing floor).
- After each page's Phase-2 capture, extract same-origin links from the **rendered** DOM and push new (normalized, deduped) URLs onto the queue — the supplement for anything the sitemap misses, not the primary mechanism.
- **Resource limits are engine design inputs, not bolt-ons:** per-page size cap and total workspace size cap enforced inside the capture loop (a cap trip degrades that page/run to partial, recorded in the report). Retrofitting these later means rework — they land here.
- **Cross-page asset dedupe with safe concurrent writes:** 3-5 workers will hit the same shared bundles/fonts simultaneously — dedupe by normalized URL (content hash as tiebreaker) with write-once semantics, which also keeps archive size sane since Framer pages share most chunks.
- Wall-clock timeout guardrail: on trip, stop gracefully and package whatever was captured, marked **partial**.
- Emit a "pages captured / total" progress feed using the sitemap count as the initial total, growing it as link discovery finds unlisted pages.
- Produce a **capture report** (`capture-report.json`) listing succeeded / failed / best-effort-degraded pages, bundled into the final zip.

**Implemented** in `apps/server/src/crawl/`: `normalizeUrl.ts` (fragment/trailing-slash dedup key for the crawl queue), `sitemap.ts` (sitemap-index-aware discovery), `workspaceBudget.ts` (concurrency-safe byte budget), `crawlSite.ts` (the `p-queue`-based BFS orchestrator, reusing Phase 2's `capturePage`/`ResourceStore` unchanged). 26 Vitest tests passing (88 total across the server package, `npm run test -w apps/server`), including three real-Chromium integration tests in `crawlSite.test.ts` covering the happy path (sitemap + link-discovery dedup), the workspace-cap trip, and the wall-clock trip.

An independent `code-reviewer` pass, scoped to this new orchestration layer (explicitly not re-litigating the already-hardened Phase 2 primitives it composes), returned **BLOCK** with the items below; all were fixed before marking this phase done:
- **Wall-clock deadlock (critical):** if `discoverSitemapUrls()` took longer than `wallClockTimeoutMs`, the timer fired while the queue was still empty (paused-and-cleared with nothing in it), and the post-sitemap `enqueue()` calls then added work to a queue nothing would ever resume — `queue.onIdle()` never resolved and the report was never written. Fixed by moving the `trippedWallClock` check into `enqueue()` itself, so seeding calls no-op once the timer has fired; an empty, never-started `PQueue` resolves `onIdle()` immediately. Regression test: a sitemap response deliberately slower than the timeout.
- **Unbounded sitemap fan-out (high):** `sitemap.ts`'s recursion-depth cap bounded nesting depth only, not the number of `<sitemap>` entries per level or total fetch count, and had no memoization — a wide or cyclic sitemap index could cause unbounded fetch blowup. Fixed with a shared `MAX_SITEMAP_FETCHES` counter and a `visited` URL set, both threaded through the recursion. Regression tests: a 200-entry wide index (asserts total fetches stay well under 200) and a duplicate nested-`<sitemap>` reference (asserts the nested URL is fetched once).
- **`WorkspaceBudget` concurrency race (high):** the check-then-add pattern (`isExceeded` read, `await capturePage`, then `add()`) let multiple in-flight pages all pass the check before any of them committed bytes, overshooting the cap by up to `concurrency - 1` pages' worth. Fixed by redesigning to a synchronous `tryReserve()` / `settle()` API — `tryReserve` commits an average-based byte estimate before the `await`, so concurrent callers see each other's reservations immediately, and `settle` reconciles the estimate against real bytes afterward.
- **Unhandled-rejection risk (high):** `enqueue()`'s `queue.add(...)` call had no `.catch()`, so any unexpected throw inside `processUrl` (including from the caller-supplied `onProgress` callback) would become an unhandled rejection that could crash the process mid-crawl. Fixed by wrapping `processUrl`'s capture logic in try/catch (converts any throw into a `'failed'` page entry) and isolating every `onProgress` call behind a `reportProgress()` helper that swallows callback errors — a caller's reporting callback must never be mistaken for a capture failure or crash the run. Regression tests for both a mid-capture throw and a throwing `onProgress`.
- **Missing `siteDir` creation (high):** `ResourceStore` only creates `siteDir` lazily on its first successful write; if every page failed before any resource was written (e.g. the target is fully unreachable), the final unconditional `_capture-report.json` write threw `ENOENT` instead of honoring the "always writes a report" guarantee. Fixed with an explicit `fs.mkdir(siteDir, { recursive: true })` at the top of `crawlSite()`. Regression test: an entirely unreachable target still produces a report with a `'failed'` page entry.

**Accepted, documented residual limitations** (not solved further — YAGNI):
- `WorkspaceBudget`'s reservation estimate is the running average of previously *settled* pages, so it's `0` until the first page settles — the very first concurrent batch can still overshoot the cap before any real byte count is known. Bounding this further would mean serializing the first batch, defeating the point of concurrency; the overshoot is capped to that one wave, not eliminated. Documented in `workspaceBudget.ts`'s class docstring.
- `normalizePageUrl` doesn't canonicalize query strings, so tracking/pagination params can inflate the distinct-page count (a query-string amplification vector, flagged medium by the reviewer). Not addressed with a new page-count cap: the existing wall-clock timeout and workspace-byte cap already bound the damage from any such amplification, and query-string canonicalization risks dropping legitimately distinct pages (e.g. real CMS pagination). Revisit only if a real site demonstrates the problem.

### Phase 4 — Revert/repair module — **complete**
- Rewrite absolute asset URLs (Framer CDN images, analytics scripts) to local copies captured in Phase 2/3, using an **origin-mirrored directory layout** (`https://framerusercontent.com/x.png` → `/framerusercontent.com/x.png`): full-origin literal string replacement for these absolute references.
- **JS chunk-to-chunk imports need no rewriting (confirmed, Phase 0):** dynamic `import()` calls inside Framer's bundles use relative paths resolved against the importing module's own URL, not runtime string concatenation of absolute URLs. Mirroring the exact `sites/{siteId}/` directory structure resolves these automatically. The origin-mirrored layout above already produces this structure as a side effect — no additional work needed here beyond preserving relative paths on disk exactly as served.
- **Image asset identity includes the query string (new finding, Phase 0):** Framer serves resize variants via query params (`?width=1024&height=1426`) that produce genuinely different bytes for the same base path — the mirror/dedup key must be the full URL including query string, not just the path, or two different resolutions will collide onto one local file.
- **Cross-platform file-path safety:** the URL→file-path mapper must sanitize for the strictest OS regardless of where it runs — Windows-invalid characters (`?`, `:`, `*`, `"`), reserved names (`con`, `nul`, etc.), case-insensitive collisions, and the 260-char path limit (hash-truncate long CDN paths). Archives must open cleanly on Mac, Windows, and Linux no matter which OS captured them.
- **Internal link handling:** rewrite same-origin page links (`<a href="https://site.framer.website/about">`) to local paths, and define the URL-path → file-path mapping (`/about` → `about/index.html`, trailing slashes, query-string handling). Decision: href rewriting handles the origin; the bundled static server handles extensionless-path → `index.html` resolution. This is what makes the Phase 7 E2E assertion ("internal links resolve locally") pass.
- **Service-worker fallback for URL rewriting:** if Phase 0 shows Framer's runtime constructing URLs dynamically (concatenation the literal replacement can't reach), inject a small service worker into the archive that intercepts fetches at runtime and maps remote origins → local paths — zero JS-bundle mutation. Viable because the archive ships with a static server (service workers require http(s); localhost qualifies). Mirrored-layout rewriting stays the default; the SW is the escape hatch.
- Strip/no-op editor-bridge, live-reload, and analytics scripts that would error or loop offline.
- Appear-effect initial states are preserved by construction (raw response capture, never DOM serialization) — no explicit "reset opacity" step needed for the common case.
- **Invariant to protect:** the rendered DOM is for link discovery and Tier 2 input *only* — never a source for archive content. The most likely way to accidentally break the core value proposition is a future "fix" that patches captured HTML based on rendered state.
- Bundle a minimal static server (or `npx serve` instructions) + README documenting best-effort categories and limitations (forms/embeds won't function offline, CMS content is a frozen snapshot, etc.).

**Implemented** in `apps/server/src/repair/`: `models/repair.model.ts` (options/result types, non-functional-script pattern list), `models/staticServerAssets.model.ts` (embedded CommonJS static-file-server source + README text), `functions/urlRewrite.function.ts` (asset-path vs. same-origin-link resolution, both graceful-degrade-to-untouched for anything not actually captured), `functions/repairHtml.function.ts` (cheerio-based rewrite of `<img>`/`<source>`/`<link>`/`<script>`/`srcset`/inline-`<style>`/`style=""` references, same-origin `<a href>` rewriting, and non-functional-script stripping), `services/localFileIndex.service.ts` (recursive on-disk directory walk building the "what was actually captured" lookup set — decoupled from `ResourceStore`'s in-memory/lifetime-scoped state on purpose), `services/repairWorkspace.service.ts` (orchestrates the above over every captured HTML file, then bundles `serve.cjs` + `README.md`). Wired into `crawlSite()` (`apps/server/src/crawl/services/crawlSite.service.ts`) right after the BFS queue drains, wrapped in try/catch (logs via `console.error`, never throws) so a repair failure degrades to serving the raw, un-repaired capture rather than losing an otherwise-successful crawl. 33 new Vitest tests (117 total across the server package, `npm run test -w apps/server`), including a real-child-process test that spawns the bundled `serve.cjs` and hits it over real HTTP.

An independent `code-reviewer` pass returned **WARNING** (0 CRITICAL, 1 HIGH, 2 MEDIUM, 3 LOW); the HIGH and both MEDIUMs were fixed before marking this phase done:
- **Unhandled crash on a malformed request path (high):** the bundled static server's `resolveFile()` called `decodeURIComponent` on the raw request path with no error handling — a request like `GET /%` throws a synchronous `URIError` that Node's `http` module doesn't catch from a request-listener callback, killing the entire `node serve.cjs` process on one malformed/bot/prefetch request. Fixed by wrapping the decode in try/catch and treating a decode failure as 404. Regression test spawns the real bundled script as a child process and confirms a malformed request returns 404 and the server is still serving afterward (`staticServerAssets.model.test.ts`).
- **Fragile module-type assumption (medium):** the bundled server was named `serve.js`, reasoned to default to CommonJS since the archive ships without its own `package.json` — but Node's ESM/CJS resolution walks up **ancestor** directories too, so extracting the archive inside any existing `"type": "module"` Node project would break `require` at startup. Fixed by renaming to `serve.cjs` (forces CommonJS unconditionally, independent of any ambient `package.json`), updating the README instructions and both test suites to match.
- **Missing test coverage for the `crawlSite` ↔ `repairWorkspace` integration (medium):** no test asserted the bundled server/README actually land after a real crawl, that an absolute same-origin href gets rewritten to a root-relative path end-to-end, or that a `repairWorkspace` failure is swallowed gracefully (crawl still completes and the report is still written). Fixed with an extended assertion on the existing full-crawl happy-path test (now uses one deliberately-absolute fixture href to prove real rewriting, not just an already-relative one) plus a new test that force-fails `repairWorkspace` via a scoped `vi.doMock` and asserts the crawl report still reports `status: 'complete'`.
- **(Low, not fixed — pre-existing, out of scope)** `srcset` values are split on every comma, which would mis-parse a `data:` URI candidate containing its own commas; this mirrors an identical pre-existing limitation in `capture/functions/htmlResourceScan.function.ts` and wasn't introduced by this phase.
- **(Low, not fixed — accepted, documented degradation)** if a same-origin page redirects somewhere `urlToLocalPath` maps to a different key than the original href implies, that link is left as a live absolute URL rather than rewritten — consistent with the module's explicit "leave untouched rather than 404" design, not a broken link.
- Also reverted an unrelated stray corruption the reviewer's `git diff` turned up in `README.md` (a code fence's `npm run dev` had been replaced with a stray backtick in an earlier session) — unrelated to this phase but caught before it could be committed accidentally.

### Phase 5 — Packaging & download (Tier 1) — **complete**
- Zip the processed workspace; stream to the client.
- Retain the workspace server-side for a short TTL (for optional Tier 2 reuse), then clean up. Clean up on any failure path too (no orphaned temp files).

**Implemented:** the first real `POST /api/capture { url }` HTTP endpoint, wiring together three new modules:
- `apps/server/src/browser/services/browserLifecycle.service.ts` — shared, lazily-launched, memoized Playwright `Browser` singleton (`getSharedBrowser()`/`closeSharedBrowser()`); first production code path in the repo to launch a real browser instead of one scoped to a test.
- `apps/server/src/packaging/` — `models/packaging.model.ts` (`WorkspaceRecord`, `WorkspaceRegistry` port interface, `CaptureJobDeps`, `CaptureJobResult`, `CaptureRoutesDeps`, `DEFAULT_WORKSPACE_TTL_MS`), `services/workspaceRegistry.service.ts` (in-memory `Map`-based TTL registry — `register`/`get`/`cleanupNow`, synchronous check-then-delete so concurrent/duplicate cleanups can't double-fire), `services/captureJob.service.ts` (`runCaptureJob`: runs the Phase 2-4 `crawlSite` pipeline into a fresh per-job workspace dir, registers it in the TTL registry on success, deletes the partial workspace immediately on any thrown failure), `services/zipWorkspace.service.ts` (`createWorkspaceZipStream`/`streamWorkspaceZip`, `archiver`-based, uses `node:stream/promises` `pipeline()` so a destination-side error or client abort tears down the archive read side too instead of leaking it), `functions/parseCaptureUrl.function.ts` (pure structural request-body validation — non-empty string, http(s) protocol only; deeper SSRF/same-origin checks stay inside the capture pipeline itself, not duplicated here).
- `apps/server/src/routes/captureRoutes.ts` — thin Express glue: validate → run capture job → stream zip response; no business logic.
- `apps/server/src/server/` — `models/gracefulShutdown.model.ts` + `services/gracefulShutdown.service.ts` (`shutdownGracefully`): on `SIGINT`/`SIGTERM`, stops accepting new connections, force-closes lingering keep-alive sockets after a grace period, and only then closes the shared browser — ordered specifically so a request already in flight on an old connection can't trigger a lazy browser relaunch mid-"shutdown".
- `apps/server/src/index.ts` rewritten from a placeholder into real app wiring: workspace root under `os.tmpdir()`, one `WorkspaceRegistry` instance, `/api/health` + `/api/capture` routes, graceful shutdown on both signals.
- Added `supertest`/`@types/supertest` as devDependencies for HTTP-level route testing (first use in the repo).
- 35 new Vitest tests across the new modules (152 total across the server package, `npm run test -w apps/server`), including: browser-lifecycle memoization/relaunch/concurrent-call tests, workspace-registry TTL/cleanup/concurrent-cleanup tests, zip-stream well-formedness/error-path tests (using a real `archiver` instance — no mocking of the zip format itself), `runCaptureJob` happy-path/failure-cleanup/custom-TTL/concurrent-jobs tests against a real fixture HTTP server and a real Playwright browser, route-level 400/500/zip-streaming tests (mocking only `runCaptureJob`/`getSharedBrowser` via `vi.doMock`, never the SSRF guard), and graceful-shutdown tests using a real `net.Socket` held open to verify both the forced-close-after-grace-period and drains-naturally paths.

An independent `code-reviewer` pass returned **WARNING** (0 CRITICAL, 2 HIGH, 2 MEDIUM, 3 LOW); all HIGH/MEDIUM findings were fixed before marking this phase done:
- **Unhandled-promise-rejection risk (high):** `createWorkspaceZipStream` called `void archive.finalize()`, discarding a promise that could reject — an unhandled rejection crashes the whole Node process (no global handler exists), same bug class as a previously-fixed Phase 3 issue. Fixed with `archive.finalize().catch((error) => archive.emit('error', error))`, funneling the rejection through the same `'error'` listener callers already attach.
- **Shutdown could hang or race a fresh browser relaunch (high):** the original inline shutdown handler called `server.close()` and moved on without confirming existing keep-alive connections had actually drained, and closed the browser without waiting — a request dispatched on an already-open connection just before shutdown could still reach a handler after the browser was "closed," silently relaunching a new one via `getSharedBrowser()`'s lazy-launch. Fixed by extracting `shutdownGracefully()`, which awaits `server.close()`'s callback (with a grace-period-triggered `closeAllConnections()` fallback for connections that never drain) before closing the browser.
- **Fragile `.pipe()` error handling (medium):** manual `.pipe()` wiring doesn't propagate a destination-side error back to the source, leaving the archive still reading from disk for an aborted/failed client. Fixed via `streamWorkspaceZip()` using `node:stream/promises`' `pipeline()`, which tears down both sides on either failing.
- **Route/function separation violation (medium):** the route handler inlined request validation instead of delegating to a pure function, and `CaptureJobDeps`/`CaptureRoutesDeps` were declared inline in service/route files rather than in a model file, violating the repo's file-role convention. Fixed by extracting `parseCaptureUrl.function.ts` and moving both interfaces into `packaging.model.ts`.
- **(Low, fixed)** Test coverage gaps for concurrent-usage paths (two capture jobs sharing one browser/registry, two concurrent `cleanupNow` calls on the same `captureId`, two concurrent `getSharedBrowser()` calls before first launch resolves) — one targeted regression test added for each.
- **SSRF guard correctness reconfirmed, not weakened:** wiring real fixture-server tests through `runCaptureJob` initially failed because the production SSRF guard correctly blocks `127.0.0.1` by default; fixed by adding a test-only `fetchDeps` override point to `CaptureJobDeps` (mirroring the existing `CrawlSiteOptions.fetchDeps` precedent), documented inline as test-only — production always uses the real guarded resolver.

**Fixed post-review (test flakiness, not a reviewer finding):** the "auto-cleans up the workspace once its TTL elapses" test intermittently failed on Windows (`EPERM: operation not permitted, rmdir`). Root cause: `workspaceRegistry.service.ts`'s `cleanupNow()` deletes its `Map` record *synchronously* before awaiting `fs.rm()`, so a test polling on `registry.get(id)` alone could observe "cleaned up" while the actual directory deletion was still in flight — racing the test's own `afterEach` `fs.rm(tempDir, ...)` on an overlapping path. Fixed by polling the filesystem directly (`fs.access(siteDir)` until it rejects) instead of the registry's in-memory state; confirmed stable across two consecutive full-suite runs (152/152 passing) after the fix.

### Phase 6 — Frontend UI (Tier 1) — **complete**
- URL textbox (client-side format validation) + authorized-use disclaimer + Download button.
- **Single-page vs. whole-site toggle** — many users want just one landing page; skipping the crawl makes the common case fast and cuts server load.
- Live progress feed via **Server-Sent Events** (one-way stream fits exactly; simpler than WebSockets, no polling) — "pages captured / total" from the sitemap seed count.
- **Preview before download:** serve the retained workspace read-only in an iframe so the user can verify animations survived before downloading a potentially large zip (workspace already exists server-side for the TTL).
- Clear states for: success, partial completion (timeout hit), and hard failure.
- On Tier 1 success, reveal the "Reconstruct as React" (Tier 2) button.

**Re-architected the capture flow from synchronous to async first.** SSE progress, pre-download preview, and a download/reconstruct choice cannot coexist on one blocking `POST /api/capture` that returns a zip. Phase 5's endpoint was replaced with a job model: `POST /api/capture { url, mode }` → **202** with a `captureId` + initial snapshot; the client then keys three follow-up endpoints off that id — `GET /capture/:id/events` (SSE progress), `GET /capture/:id/preview/*` (read-only workspace), `GET /capture/:id/download` (zip). Backend changes:
- `apps/server/src/jobs/` — new feature module owning the async lifecycle. `models/captureJobManager.model.ts` (`CaptureJobStatus`/`CaptureJobSnapshot`/`CaptureJobEvent` types, `CaptureJobManager` + `CaptureJobManagerDeps` port interfaces), `functions/sseFormat.function.ts` (pure `CaptureJobEvent` → `event: <type>\ndata: <json>\n\n` frame), `services/captureJobManager.service.ts` (`createCaptureJobManager` factory: in-memory `Map<captureId, {snapshot, listeners}>`, fire-and-forget `void runJob(...)`, subscriber fan-out with per-listener try/catch isolation, **synchronous replay of current state on subscribe** so a late subscriber still receives the terminal event, job-record cleanup via `setTimeout(...).unref()` after the workspace TTL).
- `apps/server/src/packaging/` additions — `functions/parseCaptureMode.function.ts` (pure, narrows an `unknown` body to `'single-page' | 'whole-site'`, defaults to whole-site), `models/preview.model.ts` (`PREVIEW_MIME_TYPES` allowlist + `ResolvedPreviewFile`), `functions/previewPath.function.ts` (`resolvePreviewCandidates` — mirrors the bundled static server's `/`→`index.html` + extensionless→`.html` resolution, decodes then `path.resolve`s each candidate and **verifies containment inside `siteDir`** so `..`/backslash/double-encoded traversal is dropped), `functions/previewHtmlRewrite.function.ts` (cheerio pass prefixing root-relative `src`/`href`/`srcset` + inline/`<style>` `url(/…)` with the preview base path so a workspace served under `/api/…/preview` still resolves its own assets), `services/previewWorkspace.service.ts` (`readPreviewFile` — stats each candidate, rewrites `.html`, returns other assets as raw bytes; whole-file reads are safe because capture size caps already bound each file). `captureJob.service.ts` `runCaptureJob` now takes a caller-supplied `captureId` + `mode` and forwards an `onProgress` callback.
- `apps/server/src/crawl/` — `CaptureMode` added to `crawl.model.ts`; `crawlSite.service.ts` honours it (single-page skips sitemap seeding and link-following).
- `apps/server/src/routes/captureRoutes.ts` rewritten into four thin handlers (validate → delegate → shape response); `CaptureRoutesDeps` lives in a new `routes/captureRoutes.model.ts` (references both the jobs manager and the packaging registry, so it belongs at the routes layer, not inside either feature). `index.ts` wires `createCaptureJobManager({ getBrowser: getSharedBrowser, workspaceRoot, registry })` into the routes.

**Frontend** (`apps/web/src`, first real UI — replaced the placeholder `App.tsx`), following the repo's role split (types / api / hooks / components):
- `types/capture.ts` (shared payload/status/phase types), `api/captureClient.ts` (typed `startCapture` + URL builders — components never call `fetch` directly), `hooks/useCaptureJob.ts` (owns the whole job lifecycle + `EventSource`: opens on start, follows `progress`/`done`/`failed` frames, and closes the stream on every terminal path — settle, native transport error, `reset`, and unmount — so no `EventSource` leaks).
- `components/capture/` — `CaptureForm.tsx` (URL validation + segmented whole-site/single-page radio toggle + authorized-use consent gate on submit), `ProgressFeed.tsx` (live "N / total pages" + determinate/indeterminate bar, `aria-live`), `ResultPanel.tsx` (success/partial/failed states, partial limit notes, sandboxed preview iframe, download link, disabled "Reconstruct as React" Tier 2 button). `index.css` design tokens (dark control-room palette, `prefers-reduced-motion` guard) + `App.css` component styles, all compositor-friendly transitions.
- **SSE event-name choice:** the terminal-failure frame is `event: failed`, not `error` — `EventSource` reserves `error` for its native transport event, so a server `event: error` frame would be indistinguishable from a real connection drop in `onerror`.

**Verification:** `tsc -b` clean for both apps; `apps/web` production build succeeds (≈49 kB gzipped JS, within the landing-page budget); backend suite 185/185 passing, stable across two consecutive runs.

The two independent review subagents (general quality + security) could not complete — the org hit its monthly API spend limit mid-run — so the review was performed inline against the repo's security rules. Findings fixed:
- **Preview iframe missing `sandbox` (medium, security):** the preview served attacker-influenced third-party HTML same-origin with the control UI, so a user tricked into capturing a malicious URL could let that page's JS script the app or reach the `/api/capture/*` endpoints. Fixed with `sandbox="allow-scripts"` (no `allow-same-origin`) — the captured page renders with JS in an opaque origin but cannot touch the parent app or make credentialed same-origin requests.
- **Unguarded `JSON.parse` in the SSE handler (low, robustness):** a malformed frame would throw inside the `EventSource` listener and strand the UI in the `running` phase. Wrapped in try/catch that closes the stream and transitions to `failed`.
- **Path-traversal defense reconfirmed, not weakened:** `resolvePreviewCandidates` checks containment *after* decode+resolve, and `captureId` is only ever a `Map` key (workspace paths are built from the server-generated UUID, never the client string) — a crafted id or `../` path misses the map / fails containment and 404s rather than escaping the workspace.

### Phase 7 — Tier 1 testing
- **Unit:** SSRF/URL validator, normalized-URL dedupe, asset-URL rewriter, zip packaging (zip-slip prevention).
- **Integration:** run the full crawl against a local fixture mini-site (2-3 pages: one appear-effect element, one hover/click interaction, cross-page links) — assert full discovery, well-formed zip, accurate capture report. A second integration target serves the **checked-in real-Framer-page fixture from Phase 0**, exercising actual Framer runtime markup offline.
- **E2E:** Playwright-driven UI test — paste fixture URL, click Download, unzip, serve locally, assert appear-effect/hover/click/cursor-follow behaviors work and internal links resolve locally (not to the live fixture URL).
- Real Framer sites are not hit in CI — fixtures only; real-URL smoke test is a manual pre-release checklist item.
- Coverage target: **80%+** on server-side logic (validator, dedupe, rewriter, packaging), per project testing standards.

### Phase 8 — Security review & hardening (Tier 1)
*(mandatory — this service fetches arbitrary user-supplied URLs server-side, now with an uncapped crawl. This phase **verifies** controls built earlier and adds server-capacity hardening; it is not where SSRF/limits are first implemented.)*
- Re-verify the SSRF guard built in Phase 2 (localhost/private/link-local blocks, http(s)-only, resolve-then-check-IP against DNS-rebinding) — adversarial review, not first implementation.
- Re-verify resource limits built in Phase 3 (per-page size cap, total workspace size cap, per-page timeout, crawl wall-clock timeout) plus headless browser sandboxing (no filesystem access outside the temp dir).
- Zip-slip protection when writing archive entries.
- Rate limiting on the capture endpoint (uncapped crawl + no rate limit = easy abuse vector).
- **Server capacity bounds:** max concurrent capture jobs (queue beyond it) and a global disk quota across all retained TTL workspaces — per-request rate limiting alone doesn't stop N users × one uncapped crawl each from exhausting the host.

### Phase 9 — Tier 2: mechanical DOM→JSX core
*(Expectation setting: mechanical conversion of Framer's published output yields deeply nested markup with generated class names — the realistic deliverable is "a React shell you can graft sections out of," not a hand-editable codebase. The two items below that raise that ceiling — computed-style extraction and breakpoint reconstruction — are the actual value of Tier 2.)*
- Input is the **rendered-DOM snapshots saved during Phase 2 capture** (the raw response bodies Tier 1 archives are un-executed and unsuitable here; the snapshot resolves that without re-rendering or re-crawling).
- Walk each page's rendered DOM tree, emit JSX + scoped CSS.
- **Computed-style extraction:** resolve Framer's generated class soup (`framer-1abc2d`) into readable per-component CSS instead of passing the class names through verbatim.
- **Breakpoint collapse:** Framer emits duplicated element trees per breakpoint behind `@media` blocks — detect these and emit one component with responsive styles rather than three copies.
- Structural-similarity matching collapses blocks repeated identically across crawled pages (nav/footer/cards) into shared components.
- Fully deterministic — unit-testable against fixed HTML/CSS fixtures.

### Phase 10 — Tier 2: optional AI refactor pass
- **Decision point (carried from the design doc):** choose the model/provider for the refactor pass at the start of this phase, including how the API key is configured (env var, never hardcoded) and behavior when no key is present (pass silently disabled, mechanical output shipped).
- Toggleable stage after the mechanical core: semantic renaming, tighter component boundaries, basic responsive props reconstructed from captured breakpoint CSS.
- Failure on a given page/block degrades to the mechanical output for that block — never fails the whole reconstruction.

### Phase 11 — Tier 2 packaging & frontend hookup
- `POST /api/reconstruct { captureId }` reuses the Tier 1 workspace (no re-crawl) while its TTL is still valid; explicit "capture expired, re-run Tier 1" error otherwise.
- Separate downloadable zip for the React project, independent from the Tier 1 archive.

### Phase 12 — Tier 2 testing
- Integration test: feed a Tier 1 fixture capture into Tier 2, assert valid/buildable JSX output.
- Degrade-gracefully test: force a reconstruction failure on one block, assert the rest of the page/site still reconstructs and the failed block falls back to raw markup.
- Same 80%+ coverage target applies to the mechanical DOM→JSX core and similarity matcher (both deterministic and fixture-testable).

### Phase 13 — Docs
- README covering usage, the authorized-use disclaimer, the full best-effort/limitations list from the design doc, and setup notes: local-native quickstart (`npm install` + `npx playwright install chromium` + `npm run dev`) as the primary path, optional Docker instructions only for server hosting.

## Feature Checklist (Tier 1) — reference

| Category | Status |
|---|---|
| Scroll/appear animations | Must-work |
| Hover states | Must-work |
| Click-triggered interactions | Must-work |
| Cursor-follow / magnetic effects | Must-work |
| Whole-site crawl, same-origin, no cap | Must-work |
| CMS collection lists/detail pages | Best-effort |
| Video/Lottie backgrounds, embedded media | Best-effort |
| Embedded forms / third-party widgets | Best-effort / documented limitation |
| SEO/meta tags, sitemap.xml, robots.txt | Best-effort |

## Risks

| Risk | Level | Notes |
|---|---|---|
| Framer's runtime markup/attributes change across versions | HIGH | Phase 0 spike + fixture-based tests mitigate |
| Legal/ToS — downloading someone else's published site | HIGH | Authorized-use disclaimer surfaced before every capture |
| SSRF via server-side URL fetch | HIGH (security) | Guard built in Phase 2 (before any fetch path exists), adversarially re-verified in Phase 8 |
| Asset-URL rewriting inside JS bundles breaks dynamic chunk/asset loading | LOW (was MEDIUM-HIGH) | Confirmed in Phase 0: chunk imports are relative, resolved automatically by mirroring directory structure — no JS rewriting needed. Only absolute image/analytics URLs need literal replacement. Service-worker fallback kept as a defensive measure |
| Hover/click/cursor-follow runtime behavior unverified without a browser | MEDIUM | Markup/mechanism confirmed present in raw HTML (Phase 0); functional confirmation still needs Playwright reconnected or a manual pass before Phase 2 completes |
| Uncapped whole-site crawl on very large sites | MEDIUM-HIGH | Accepted trade-off (user's choice); wall-clock timeout + rate limiting are the safety net, not a page cap |
| Tier 2 output fidelity/non-determinism (AI pass) | MEDIUM | Mechanical core is always a valid deterministic fallback |
| Multi-page CMS content not linked via rendered `<a>` tags | LOW (was MEDIUM) | Largely mitigated by sitemap-first discovery (Framer's sitemap lists CMS pages); link discovery remains as supplement |
| Tier 2 output value ceiling (generated class soup, duplicated breakpoint trees) | MEDIUM | Expectation set in Phase 9; computed-style extraction + breakpoint collapse are the mitigations |
| Large media (video/hi-res images) → huge archives/timeouts | MEDIUM | Per-page and total size caps, clear partial-completion messaging |
| Playwright/Chromium deployment footprint | LOW for local use / MEDIUM if hosted | Local: `npx playwright install chromium`, no Docker. Hosted: persistent server needed, not serverless-friendly; Docker optional packaging |

## Estimated Complexity: HIGH

- Phase 0 spike: 0.5–1 day
- Phases 1-2 (scaffolding + single-page capture): 1–2 days
- Phase 3 (BFS crawl engine): 1.5–2.5 days
- Phase 4 (revert/repair): 1–1.5 days
- Phase 5-6 (packaging + Tier 1 UI): 2–3 days *(grew: single-page toggle, SSE progress, pre-download preview)*
- Phase 7-8 (Tier 1 testing + security): 2–3 days
- Phase 9 (mechanical DOM→JSX): 2–3 days
- Phase 10 (optional AI refactor pass): 1.5–2.5 days
- Phase 11-12 (Tier 2 packaging + testing): 1.5–2 days
- Phase 13 (docs): 0.5 day

**Suggested milestone split:** Phases 0-8 = Tier 1 MVP (a complete, shippable deliverable on its own). Phases 9-13 = Tier 2, built only after Tier 1 is validated against a real site.

---

**Status**: Phases 0-6 complete. Phase 7 (Tier 1 testing) next.
