# Framer Site Cloner

Paste a published Framer site URL, get back a downloadable, offline-browsable copy — with scroll/appear animations, hover states, and click interactions intact. An optional second pass can reconstruct a best-effort React codebase from the same capture.

See [`PLAN.md`](./PLAN.md) for the full phased implementation plan and [`docs/plans/`](./docs/plans/) for the design doc and research findings.

## Status

**Phase 1 (project scaffolding) complete.** The app is not functional yet — there's no capture logic, no UI beyond a placeholder that checks the backend is reachable. Capture (Tier 1) and React reconstruction (Tier 2) land in later phases.

## Prerequisites

- Node.js 20+
- No Docker required — everything runs natively (Windows, macOS, Linux).

## Setup

```bash
npm install
npx playwright install chromium
```

The first command installs all workspace dependencies. The second downloads a Chromium binary (~130MB) into your user profile — no admin rights needed. It's a separate step on purpose: if it fails (e.g. no network), `npm install` still succeeds and you can retry it independently.

## Run

```bash
npm run dev
```

Starts both dev servers together:
- **Web** — `http://localhost:5173` (Vite + React)
- **Server** — `http://localhost:3001` (Express API)

The web dev server proxies `/api/*` requests to the backend, so no CORS setup is needed. Visiting `http://localhost:5173` should show a status of `ok` if the backend is reachable.

## Project structure

```
apps/
  web/     Vite + React + TypeScript frontend
  server/  Express + TypeScript backend (Playwright, archiver, p-queue)
```

Each app has its own `dev`/`build` scripts; `npm run dev`/`npm run build` at the root run both via npm workspaces.

## Authorized use only

Only capture sites you own or are explicitly authorized to copy. This tool is not for downloading someone else's published site without permission.
