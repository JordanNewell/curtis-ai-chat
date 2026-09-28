# Curtis AI Chat — Agent Guide

Obsidian plugin (id: `curtis-ai-chat`), TypeScript + esbuild bundled to `main.js`.

## Build & verify

- `npm run build` — type-checks (`tsc -noEmit -skipLibCheck`) then production bundle. Run before declaring any task done.
- `npm run lint` — eslint on `src/`. Zero warnings before commit.
- `npm run version` — bumps `manifest.json` and `versions.json` together via `version-bump.mjs`. Never edit one without the other.

## Hard constraints

- `minAppVersion` is **1.11.4** — the Obsidian API floor. Releases before 2026-07 shipped broken installs because this was wrong; do not regress it.
- `versions.json` maps plugin version → minimum Obsidian version; every release needs its entry.
- Release notes and marketplace copy: terse, no emoji.

## Layout

- `src/` — plugin source. `main.js` at root is the build artifact; never hand-edit it.
- `demo-vault/` — local test vault. `assets/` and `docs/` are published.
