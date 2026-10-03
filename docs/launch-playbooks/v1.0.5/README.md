# Curtis AI Chat v1.0.5 — Announcement Kit

Patch-release promo package. All copy paste-ready; TODO markers flag the few things only the author can supply (on-phone screenshots, anecdotes, thread links).

## Screenshots

Regenerate any time with `npm run shots` (Playwright-core driving Obsidian over the Chrome DevTools Protocol; it closes and relaunches your Obsidian automatically, and restores your session after). Current assets in `assets/screenshots/`: `desktop-chat.png`, `chat-panel.png` (300x760 panel crop — good hero image), `desktop-settings-providers.png`, `ollama-provider-settings.png`. On-a-phone shots are the only manual capture left (TODOs in the Reddit post).

## What's shipping in 1.0.5

- **Fix:** local providers (Ollama, LM Studio) no longer wrongly require an API key on mobile. Previously the mobile settings flow demanded a key before a local provider could be saved — local servers have no key, so the fully-local path was desktop-only. Now the requirement is gone on every platform.
- **Maintenance:** CI and dependency bumps.

The angle for every post: **local AI now works properly on mobile — no key prompts.** But each post pitches the plugin overall (30+ providers, agent tools, arena, diff rewrite, local-first, MIT); the fix is the hook, not the whole story.

## Files

1. **`30-show-hn.md`** — Show HN submission. Title + first-comment body.
2. **`40-reddit-obsidianmd.md`** — r/ObsidianMD post. Needs screenshots before posting.
3. **`60-discord-obsidian.md`** — Obsidian Discord #plugins announcement. Short.
4. **`70-community-directory-reply.md`** — reply templates for community.obsidian.md threads and reviews.

Numbering follows the v1.0.0 kit; gaps are intentional. A patch release does not get its own release-notes file (the GitHub Release body comes from CHANGELOG.md), a community-submission file (the plugin is already listed), or a Twitter kit.

## Checklist — where and when to post

| # | Channel | File | When | Done |
|---|---------|------|------|------|
| 0 | GitHub Release (tag `1.0.5`, body from CHANGELOG) | — | Immediately after CI goes green on the tag | [ ] |
| 1 | community.obsidian.md — reply in any thread that reported the mobile key-prompt bug | `70-...` | Same hour as the release; existing bug-reporters are the audience most waiting on this | [ ] |
| 2 | Obsidian Discord #plugins | `60-...` | Same day | [ ] |
| 3 | r/ObsidianMD | `40-...` | Same day or next morning (Tue–Thu morning US time is the historical peak). Do not post until screenshots are captured | [ ] |
| 4 | Hacker News Show HN | `30-...` | Only if no Show HN has run for this plugin before. Tue–Thu 7:30–9:30am PT. If a prior Show HN exists, comment in that thread instead of resubmitting | [ ] |

Space posts 15–30 minutes apart so early replies get answered, not stacked.

## Pre-flight gates (before posting anything)

- [ ] `npm run build` — type-check + bundle clean
- [ ] `npm run lint` — zero warnings
- [ ] `npm run version` — bumps `manifest.json` and `versions.json` together to 1.0.5
- [ ] CHANGELOG.md has a dated `1.0.5` entry
- [ ] Release tagged `1.0.5` (no `v` prefix), assets attested, directory update propagated
- [ ] Screenshots captured for Reddit (see TODOs in `40-...`)
- [ ] Every TODO in each file resolved or deleted

## Locked facts (use verbatim)

- Repo: https://github.com/JordanNewell/curtis-ai-chat
- Site: https://jordannewell.github.io/curtis-ai-chat/
- Directory: https://community.obsidian.md/plugins/curtis-ai-chat
- License: MIT. No telemetry, no account, no SaaS.
- API floor: Obsidian 1.11.4+
- Mobile local setup: desktop runs Ollama/LM Studio, phone on same LAN, base URL `http://<desktop-ip>:11434/v1/chat/completions`

## Not in this kit

- Twitter/Mastodon. Optional for a patch release; if wanted, the v1.0.0 thread structure still fits — lead tweet becomes the mobile-local fix.
- Video demo. Not needed for a patch; a single mobile screenshot of chat running against Ollama is the highest-value asset.
