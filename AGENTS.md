# Curtis AI — Agent Guide

Obsidian plugin (id: `curtis-ai-chat`), TypeScript + esbuild bundled to `main.js`.

## Build & verify

- `npm run build` — type-checks (`tsc -noEmit -skipLibCheck`) then production bundle. Run before declaring any task done.
- `npm run lint` — eslint on `src/`. Zero warnings before commit.
- `npm test` — vitest over `src/**/*.test.ts`. Modules under `src/autocomplete/` (except the editor extension) are deliberately Obsidian-free so they run under node; keep that boundary.
- `npm run version` — bumps `manifest.json` and `versions.json` together via `version-bump.mjs`. Never edit one without the other.
- `npm run site:sync` — syncs version/platform tokens from manifest.json into docs/index.html. Run after `npm run version`.

## Hard constraints

- `minAppVersion` is **1.13.0** — set by the declarative `getSettingDefinitions()` settings API (adopted v1.2.0, after 1.13.6 hit the stable channel for all users in Aug 2026; before that the floor was 1.11.4). Whatever the floor is at any moment, `manifest.json` and `versions.json` must match reality — releases before 2026-07 shipped broken installs because they lied; never do that again.
- `versions.json` maps plugin version → minimum Obsidian version; every release needs its entry.
- Release notes and marketplace copy: terse, no emoji.

## Layout

- `src/` — plugin source. `main.js` at root is the build artifact; never hand-edit it.
- `demo-vault/` — local test vault. `assets/` and `docs/` are published.
