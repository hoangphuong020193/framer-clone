# Design: Full Framer Site Clone (Tier 1 Archival Snapshot + Tier 2 React Reconstruction)

Supersedes/extends the animation-focused scope in `PLAN.md` at the project root. This document captures the full-clone brainstorm, validated section by section with the user.

## Goal

Given a single Framer-published URL, produce:
- **Tier 1 (primary):** a whole-site, browsable, offline archival snapshot with working animations/interactions.
- **Tier 2 (secondary, on-demand):** a best-effort, editable React codebase reconstructed from the Tier 1 capture.

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

- **Tier 1:** Node/TS backend + Playwright. Integrated BFS crawl: 3-5 concurrent browser contexts, same-origin link discovery from the *rendered* DOM (not just static `<a>` tags, since Framer can render nav client-side), cycle-safety dedupe on normalized URLs, and an operational wall-clock timeout as a safety net (the user explicitly chose no artificial page cap). Each page capture persists **raw network response bodies** (not the live/mutated DOM — this is the fix for the opacity:0-stuck animation problem) and runs a revert/repair pass: rewrite asset URLs to local relative paths, strip editor-bridge/analytics/live-reload scripts that would error offline, preserve appear-effect initial states by construction (since we never serialize the mutated DOM).
- **Tier 2:** consumes the Tier 1 output as input — no re-crawl. Mechanical DOM→JSX converter walks each captured page, emits JSX + scoped CSS, and a structural-similarity pass collapses blocks repeated identically across crawled pages (nav/footer/cards) into shared components. An optional, toggleable AI refactor pass runs after the mechanical core to improve naming/component boundaries — the mechanical core alone is always a valid, deterministic fallback.
- **Frontend:** single React/Vite page. URL textbox + "Download" button triggers Tier 1. On completion, a "Reconstruct as React" button appears and triggers Tier 2 against the just-completed capture (kept server-side for a short TTL).

## Feature Checklist (Tier 1)

| Category | Status | Notes |
|---|---|---|
| Scroll/appear animations | Must-work | Fixed by capturing raw responses, not mutated DOM |
| Hover states | Must-work | Pure CSS in almost all cases |
| Click-triggered interactions (accordions, modals, tabs, variant switches) | Must-work | JS-driven, same "preserve original JS + initial state" principle |
| Cursor-follow / magnetic effects | Must-work | JS-driven, most fragile — depends on runtime JS surviving capture untouched |
| Whole-site multi-page crawl, same-origin, no cap | Must-work | BFS crawl, cycle-dedupe + timeout as built-in safety net (not a scope cap) |
| CMS collection lists/detail pages | Best-effort | Covered if reachable via rendered `<a href>` links; no special-cased CMS JSON/pagination handling |
| Video/Lottie backgrounds, embedded media | Best-effort | Downloaded as assets if discoverable during capture; no re-encoding/optimization |
| Embedded forms / third-party widgets (Framer forms, Calendly, maps) | Best-effort / documented limitation | Submission endpoints point at the original site or fail offline |
| SEO/meta tags, favicons, `sitemap.xml`, `robots.txt` | Best-effort | Copied through as part of normal asset capture |

## Data Flow

1. Frontend → `POST /api/capture { url }`.
2. Backend validates URL format (http/https only) and runs the SSRF guard (resolve DNS, reject private/link-local/metadata-endpoint IPs) before any fetch.
3. Entry URL seeds the BFS queue; worker pool (3-5 Playwright contexts) pops URLs, skipping already-visited (normalized) ones.
4. Per page: navigate → intercept & persist raw response bodies → wait for network-idle → extract same-origin links from the rendered DOM → push new links to the queue → revert/repair pass.
5. On queue drain (or timeout) → package the workspace into a zip with a bundled static server + README, including a **capture report** (succeeded/failed/best-effort-degraded pages).
6. Client downloads the zip; workspace kept server-side for a short TTL for optional Tier 2 reuse, then cleaned up.
7. Optional: `POST /api/reconstruct { captureId }` reuses the Tier 1 workspace → mechanical DOM→JSX + structural dedupe → optional AI refactor toggle → separate downloadable React project zip.

## Error Handling

- Bad URL / SSRF-blocked target → rejected pre-fetch, generic error, attempt logged.
- Single-page capture failure → does not fail the whole crawl; page skipped and recorded in the capture report.
- Whole-crawl timeout → stop gracefully, package what's captured so far, clearly mark the run as **partial** (UI + report) — never silently presented as complete. Partial results are still downloadable.
- Packaging failure → clear error, temp files cleaned up regardless of outcome.
- Tier 2 per-page/per-block reconstruction failure → degrade to raw HTML/JSX passthrough for that block, not a full-run failure.
- Tier 2 requested after Tier 1 workspace TTL expiry → explicit "capture expired, please re-run Tier 1" message.

## Testing Strategy

- **Unit:** SSRF/URL validator, normalized-URL dedupe, asset-URL rewriter, DOM→JSX converter (fixture-based, deterministic output), structural-similarity component matcher, zip packaging (zip-slip prevention).
- **Integration:** full Tier 1 pipeline against a local fixture "mini-site" (2-3 pages covering an appear-effect element, a hover/click interaction, and cross-page links) — asserts full-site discovery, well-formed zip, accurate capture report. A second integration test feeds that Tier 1 output into Tier 2 and asserts valid, buildable JSX output.
- **E2E:** Playwright test driving the actual frontend UI — paste fixture URL, click Download, unzip, serve locally, assert appear-effect/hover/click behaviors work and internal links resolve locally, not to the live fixture URL.
- Real Framer sites are not hit in CI (fragility, rate-limit, ToS risk) — fixtures only; a manual smoke test against a real Framer URL is a pre-release checklist item.

## Explicitly Out of Scope / Known Limitations

- Legal/ToS: only for sites the user owns or is authorized to copy — shown as a disclaimer before every capture.
- Embedded forms/third-party widgets never become functional offline — visually render, submissions fail or hit the original site.
- No authentication/gated-content crawling — public pages only.
- CMS content is a frozen snapshot at capture time, not a live connection.
- Cross-page SPA client-side router *state* (not reflected in the URL) is not replicated — each crawled page is captured as an independent load.
- Tier 2 output is a best-effort reconstruction starting point, not a guaranteed 1:1 buildable React port for highly complex layouts.

## Open Decisions Carried Forward (for the implementation plan)

- Exact wall-clock timeout value for the "no page cap" crawl safety net.
- Concurrency level (3 vs 5 contexts) — likely needs empirical tuning against a real site in the Phase 0 spike.
- Whether the AI refactor pass (Tier 2) uses a specific model/provider — deferred until Tier 2 implementation phase.
