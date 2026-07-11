# CLAUDE.md

Project-specific guidance for working in this repository. This extends (does not replace) the user's global rules in `~/.claude/rules/`. Where this file gives a more specific number or pattern, follow this file.

## What this project is

A tool that captures a published Framer site (whole-site, not just one page) into an offline-browsable archive, with an optional second pass that reconstructs a best-effort React codebase from the same capture. See `PLAN.md` for the full phased plan and `docs/plans/` for design docs.

## Tech stack

| Layer | Choice |
|---|---|
| Monorepo | npm workspaces (`apps/*`), Node 20+, no Docker in the dev/run path |
| Frontend (`apps/web`) | Vite, React 18, TypeScript (strict) |
| Backend (`apps/server`) | Express, TypeScript (strict), Playwright (capture browser), Cheerio (HTML parsing), `undici` (HTTP fetch), `p-queue` (concurrency), `archiver` (zip) |
| Tests | Vitest, co-located `*.test.ts` files |
| Package manager | npm |

There is no ESLint/Prettier config in this repo yet. Until one is added, treat the size/structure limits below as the enforced convention — review diffs against them manually.

## Repository layout

```
apps/
  web/     Vite + React + TypeScript frontend
  server/  Express + TypeScript backend
    src/
      capture/   feature module: single-page capture pipeline
      index.ts   Express app wiring only — no business logic here
docs/plans/      design docs and research spikes
PLAN.md          phased implementation plan (source of truth for scope/status)
```

New backend features get their own folder under `apps/server/src/<feature>/`, following the `capture/` module as the template (see below). New frontend features get their own folder under `apps/web/src/components/<feature>/` or `apps/web/src/features/<feature>/` once the UI grows past a single `App.tsx`.

## Folder structure: split by role, never one combined file

Code is separated into role-based files — models, functions, services, routes — never combined into one file that declares types, implements logic, and wires I/O together. **Every non-route file's suffix says what role it plays; interfaces/types, pure functions, and I/O-or-stateful logic each get their own file, never mixed in the same one:**

- `*.model.ts` — types, interfaces, and pure constants for a feature. No logic, no I/O.
- `*.function.ts` — pure, stateless functions: same input always produces the same output, no `fetch`/`fs`/Playwright/network, no mutable module-level state, no classes.
- `*.service.ts` — anything with I/O (network, filesystem, browser), encapsulated/mutable state (classes, factories returning stateful objects, queues, budgets), or orchestration across multiple functions/services.

### Backend (`apps/server/src`) target shape

```
src/
  index.ts                 app bootstrap only (create app, listen)
  routes/                  Express routers — parse/validate request, call a service, shape the response. No business logic.
    captureRoutes.ts
  <feature>/               one folder per feature (capture/, crawl/, packaging/, ...)
    models/
      <feature>.model.ts   types/interfaces/constants for this feature
    functions/
      <name>.function.ts   pure, stateless helpers this feature's services call
    services/
      <name>.service.ts    I/O, stateful, or orchestrating logic
  utils/                   small, generic, feature-agnostic helpers only
```

A feature with only one file per role may keep them flat at the feature root (`<feature>/foo.function.ts`) instead of a subfolder — group into `models/`/`functions/`/`services/` once a feature has more than one file in that role. The suffix is mandatory either way; the subfolder is just organization once there's enough to organize.

Rules:
- **Models** — shared interfaces/types/constants for a feature live in their own `*.model.ts`, not inline at the top of whichever function/service happened to need them first. **Model files are the exception to "one export per file":** a `<feature>.model.ts` may group many related interfaces, type aliases, and constants (defaults, limits) — declarations are cheap to read, so keeping a feature's data shapes together beats scattering them across ten tiny files. Split into multiple `*.model.ts` files only once one passes the normal size ceiling. A model file must NOT contain behavior: no I/O, no business logic — declarations and pure constants only. If two features share a type, lift it to a shared `models/` folder — don't import one feature's internals from another.
- **Functions** — pure logic only, one exported concept per `*.function.ts` file. If a "function" file needs `fetch`/`fs`/a browser handle, or holds state across calls, it's not a function — it's a service; rename and move it.
- **Services** — business logic, I/O, and orchestration live here, in files that know nothing about Express (`req`/`res` never appear in their signatures). This is what makes them unit-testable without HTTP. A service may export a class, a factory returning a stateful object (closures over mutable state), or an async function that performs I/O.
- **routes/controllers** — the only place Express appears. A route handler is glue: validate input → call a service → map result/error to a response. If a handler is longer than ~20 lines, logic is leaking in — push it down into the service.
- **utils** — only genuinely generic helpers (string/URL/fs helpers with no feature knowledge), still suffixed `*.function.ts` or `*.service.ts` per the same rule. If a "util" imports feature code, it's not a util — it belongs in that feature's folder.
- **Dependency direction:** `routes → services → functions/models`. Never the reverse — a `*.function.ts` or `*.model.ts` never imports a `*.service.ts`.

### Frontend (`apps/web/src`) target shape

```
src/
  main.tsx               bootstrap only
  App.tsx                top-level composition only
  components/<feature>/  one folder per UI feature, one component per file
  hooks/                 custom hooks (useCaptureJob.ts, ...) — data fetching/effects live here, not in component bodies
  services/ or api/      typed API client functions (fetch wrappers) — components never call fetch() directly
  types/ or models/      shared TS interfaces (API payloads, job status, ...)
  utils/                 generic pure helpers
  styles/                shared CSS/tokens
```

The same separation applies: a component renders; a hook owns state/effects; an api/service module talks to the server; a types file declares the shapes. One file doing all four is the exact anti-pattern this repo forbids.

## The core rule: small files, one concern each

This is the most important convention in this repo. Do not combine multiple features or responsibilities into one file or one function — it's the main way this codebase stays reviewable and testable.

**Reference implementations:** both backend feature modules follow the `*.model.ts`/`*.function.ts`/`*.service.ts` convention in full — use either as the template for new features:

- `apps/server/src/crawl/` — `models/crawl.model.ts`, `functions/{normalizeUrl,pageReportEntry}.function.ts`, `services/{workspaceBudget,sitemap,crawlReportFile,wallClockQueue,crawlSite}.service.ts`.
- `apps/server/src/capture/` — six `models/*.model.ts` files (one per concern), `functions/{ipBlocklist,urlPathMapping,htmlResourceScan}.function.ts` (pure logic), `services/{ssrf,fetchResource,resourceStore,browserDiscovery,capturePage}.service.ts` (I/O and orchestration), plus `testUtils/fixtureServer.ts` (test scaffolding — exempt from the suffix rule).

No interface lives in a service file — not even one that describes a service object. When a model-level type needs to reference a service's shape (e.g. `CapturePageOptions.store`), declare a **port interface** in the model (`ResourceStorePort` in `resourceStore.model.ts` lists the store's public methods) and have the service class `implements` it. The model depends on the port; the service depends on the model — the `routes → services → functions/models` direction is never reversed. `testUtils/` follows the same split for its types (`fixtureServer.model.ts`), re-exported from the helper for convenient test imports.

Each file has one job, is independently testable, and has a matching `*.test.ts` next to it. **Follow this pattern for every new feature** — do not add a new capability by growing an existing file past its single responsibility; give it its own file instead.

### Concrete limits for this repo

- **File size:** aim for under 150 lines, treat 250 as a hard ceiling. If a file wants to grow past that, it's a sign it's doing more than one job — split it (see `capture/` above for the shape a split should take).
- **Function size:** aim for under 30 lines, hard ceiling 50. A function that needs a hard ceiling that high is usually two functions wearing a trenchcoat — extract the inner steps into named helpers.
- **One export concept per file** (for logic files). A file named `fetchResource.ts` exports fetching logic, not fetching + path mapping + persistence. If you're tempted to add a second unrelated export, that's a new file. *Exception:* model/type files (`models.ts`, `types.ts`) may group many related interfaces, classes, and constants — see the models rule in the folder-structure section.
- **Orchestrators stay thin.** `capturePage.ts` is the one file allowed to be "the biggest" in a feature, because its only job is to call the single-purpose pieces in order. Keep orchestration code free of the actual logic (parsing, validation, I/O) — that logic belongs in the pieces it calls.
- **Express route/handler files wire things together; they don't contain business logic.** `index.ts` should stay a thin composition file (as it is today at 12 lines) — request handling, validation, and capture logic live in their own modules under `src/<feature>/`.
- **React components:** one component per file. A component file that renders more than one logically-distinct section of UI should be split into subcomponents in a folder (`components/<feature>/`), each with a focused render responsibility. Extract non-trivial logic (data fetching, derived state, effects) into a custom hook (`use*.ts`) rather than inlining it in the component body.

## TypeScript conventions

- `strict` is already on in both `tsconfig.json`s — keep it that way. Don't add `// @ts-ignore` or loosen strictness to unblock a change; fix the type.
- No `any` in application code. Use `unknown` for untrusted input (fetch responses, request bodies) and narrow it explicitly.
- Explicit parameter and return types on every exported function. Let TypeScript infer local variable types.
- Prefer `interface` for object shapes, `type` for unions/intersections. Prefer string-literal unions over `enum`.
- Immutable updates only — return new objects/arrays, never mutate function inputs (this includes Express `req`/`res` locals you construct yourself).

## Backend conventions (`apps/server`)

- **SSRF guard is non-negotiable and comes first.** Every new code path that fetches a URL derived from user input (including a page's own sub-requests, redirects, or a Playwright-driven navigation) must go through the same validate-then-fetch guard as `ssrf.ts` / `fetchResource.ts` — resolve-then-check-IP, http(s)-only, block localhost/private/link-local ranges. Do not add a second, parallel fetch path that bypasses it.
- **Response size caps** on anything read into memory (see `fetchResource.ts`'s `MAX_RESPONSE_BYTES` pattern) — never buffer an unbounded remote response.
- **Path safety:** any code deriving a filesystem path from a URL or user input must sanitize it (see `urlPathMapping.ts`) and the write layer must independently verify containment inside its root directory (see `resourceStore.ts`'s defense-in-depth check) — don't rely on the mapper alone.
- **Resource lifecycle:** Playwright contexts, browser instances, and file handles are opened in a `try`/`finally` so an error mid-operation can't leak them (see `browserDiscovery.ts`).
- **Concurrency-safe writes:** if a store is used from concurrent workers (as `resourceStore.ts` is designed to be for the future crawl engine), the check-then-claim step must be synchronous — no `await` between checking a collision and reserving it.

## Frontend conventions (`apps/web`)

- Component props are a named `interface`, not inline object types.
- Don't use `React.FC` unless there's a specific reason.
- Keep server state (capture job status, progress) and client/UI state separate — don't stuff both into one `useState` blob as the UI grows.
- No component should both fetch/orchestrate data *and* render a large, multi-section UI — split into a thin container (data/orchestration) and presentational subcomponents once `App.tsx` grows past a placeholder.

## Testing

- Vitest, co-located `*.test.ts` next to the module it tests (matches the existing `capture/` layout).
- Arrange-Act-Assert structure, descriptive test names (`returns X when Y`), not `test('works')`.
- 80%+ coverage target on server-side logic, per the project plan (`PLAN.md`, Phase 7).
- Run backend tests with `npm run test -w apps/server`.

## Commands

```bash
npm install                        # install all workspaces
npx playwright install chromium    # one-time browser binary (no admin needed)
npm run dev                        # web (5173) + server (3001) together
npm run build                      # build both apps
npm run test -w apps/server        # backend test suite
```

## Do not

- Do not add a new "does everything" file (e.g. a single `crawler.ts` that fetches, parses, validates, and writes). Split by concern from the start — retrofitting later means a rewrite, not a refactor.
- Do not bypass the SSRF guard for a "quick" fetch, even in a script or one-off endpoint.
- Do not introduce Docker into the local dev/run path — it stays optional/deferred for hosting only (see `PLAN.md` Phase 1 rationale: this must run natively on Windows/macOS/Linux).
- Do not commit real third-party Framer site captures beyond the checked-in fixture at `docs/fixtures/real-framer-capture/` — tests run against fixtures, not live sites.
