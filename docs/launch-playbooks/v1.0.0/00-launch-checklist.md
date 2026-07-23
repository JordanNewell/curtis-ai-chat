# v1.0.0 Launch Day Checklist

**Sequenced. Do not skip ahead.** Each step gates the next.

State at start: master is 3 commits ahead of origin (v1.0.0 release commit `659de17` local-only). Folder already renamed to `E:/dev/projects/curtis-ai-chat/`. README + CONTRIBUTING URLs fixed. CHANGELOG, manifest, package.json all at 1.0.0.

---

## Phase A — Pre-flight verification (5 min)

- [ ] `cd E:/dev/projects/curtis-ai-chat && git status` — clean tree, on master
- [ ] `npm run build` — exit 0, `main.js` written
- [ ] `npx eslint src --ext .ts` — zero warnings
- [ ] `git log --oneline origin/master..HEAD` — shows 3 commits (the v1 work)
- [ ] `cat manifest.json | grep version` — `1.0.0`
- [ ] `git tag --list "4.*"` — empty (no 1.0.0 tag yet)
- [ ] Reload Obsidian test vault, smoke-test: open chat, send to 1 provider, run agent tool, arena, diff rewrite, slash command `/export`

## Phase B — Repo rename (2 min)

- [ ] `gh repo rename curtis-ai-chat --repo JordanNewell/curtis-chat`
      Expected: `✓ Renamed JordanNewell/curtis-chat to JordanNewell/curtis-ai-chat`
- [ ] `git remote set-url origin https://github.com/JordanNewell/curtis-ai-chat.git`
- [ ] `git remote -v` — both fetch/push point at `curtis-ai-chat.git`
- [ ] `git fetch origin` — succeeds (verifies the rename + new URL)

## Phase C — Push master (1 min)

- [ ] `git push origin master`
      Expected: 3 commits delivered, no hook failures
- [ ] Refresh https://github.com/JordanNewell/curtis-ai-chat — verify README renders, hero banner shows

## Phase D — Tag + release (5 min + ~3 min CI wait)

- [ ] `git tag -a 1.0.0 -m "Release 1.0.0 — Curtis AI Chat rebrand + agent + arena + voice + 4 more"`
      **NO `v` prefix.** Tag must match `manifest.json` version exactly per Obsidian submission rules.
- [ ] `git push origin 1.0.0`
- [ ] Watch the Release workflow: https://github.com/JordanNewell/curtis-ai-chat/actions
      Expected: `release.yml` triggers, builds `main.js` + `manifest.json` + `styles.css`, generates attestations, creates release with auto-generated notes.
- [ ] `gh release view 1.0.0` — verify 3 assets present (`main.js`, `manifest.json`, `styles.css`)
- [ ] If assets missing: `gh release upload 1.0.0 main.js manifest.json styles.css --clobber`

## Phase E — Curated release notes (3 min)

- [ ] Edit the release title: `gh release edit 1.0.0 --title "Curtis AI Chat 1.0.0"`
- [ ] Replace auto-generated body with curated notes:
      `gh release edit 1.0.0 --notes-file marketing/v1.0.0-launch/10-release-notes.md`
      (Strip the `## Body` header line and everything above it first; release notes start at the bold tagline.)
- [ ] Verify on the release page: title, body, assets, attestation badges all render.

## Phase F — community.obsidian.md submission update (10 min)

- [ ] Log in to https://community.obsidian.md
- [ ] Open your plugin submission dashboard
- [ ] For the old `curtis` plugin: leave as-is (v3.0.1 stays listed). Optionally edit the description to "Replaced by curtis-ai-chat — see author's other plugins."
- [ ] **Submit new plugin** with fields from `marketing/v1.0.0-launch/20-community-submission.md`:
      - Repo URL: https://github.com/JordanNewell/curtis-ai-chat
      - Plugin name: Curtis AI Chat
      - Cover letter from the submission doc

## Phase G — Deploy vaults (5 min per vault)

For each Obsidian vault using the plugin (test vault + personal + any fleet vaults):

- [ ] Disable old `curtis` plugin under Community plugins
- [ ] Delete `<vault>/.obsidian/plugins/curtis/` folder
- [ ] Install fresh at `<vault>/.obsidian/plugins/curtis-ai-chat/` (copy `main.js`, `manifest.json`, `styles.css` from the release)
- [ ] Enable **Curtis AI Chat**
- [ ] Re-enter API keys (OS keychain stores them, but per-plugin — they don't carry across the ID change)
- [ ] Smoke test: chat with one provider, run one agent tool, open settings panel

## Phase H — Public announce (1 hour, time-boxed)

Order matters. Post in this order so each channel can link the next:

- [ ] **Twitter/X** — main thread (`50-twitter.md`). Pin for 48 hours.
- [ ] **Reddit /r/ObsidianMD** — `40-reddit-obsidianmd.md`
- [ ] **Hacker News** — `30-show-hn.md` (best Tue–Thu 7:30–9:30am PT)
- [ ] **Obsidian Discord** — `60-discord-obsidian.md` in #showcase or #general
- [ ] **Mastodon** — cross-post the Twitter thread, add hashtags

Space these out by ~15–30 min so you can engage with early replies on each, not all at once.

## Phase I — Internal handoff (10 min)

- [ ] Update `e:/vaults/claude.code.xyz/COLLAB.md` — new session entry at top: "curtis-ai-chat v1.0.0 SHIPPED to directory"
- [ ] Update memory: `~/.claude/projects/C--Users-jrnew/memory/project_curtis-ai-chat-v1-shipped-2026-07-22.md` — flip status from "test vault only" to "released". Update MEMORY.md quick-link one-liner.
- [ ] Optional: post in personal Discord/Slack channels, link in email signature

## Phase J — Watch the first 48 hours

- [ ] Star/watch the repo for issues
- [ ] Set up GitHub Discussions if not enabled (repo settings → features → Discussions)
- [ ] Triage incoming issues: label bugs vs features vs docs
- [ ] Engage on HN/Reddit/Twitter replies — first 4 hours matter most for ranking
- [ ] If directory review comes back with feedback, address within 24h

---

## What NOT to do

- **Don't** push before renaming the repo — README URLs will 404 briefly
- **Don't** add `v` prefix to the tag — Obsidian submission will fail review
- **Don't** `--no-verify` past any git hook — fix the underlying issue instead
- **Don't** post to socials until release notes are curated (the auto-generated ones are ugly)
- **Don't** cross-post the same message to multiple Obsidian Discord channels — pick one
- **Don't** install the new plugin to a production vault without smoke-testing the test vault first

## Recovery if something goes wrong

- **release.yml fails:** `gh run view` the failing run. Most common: missing `id-token: write` permission (already in the workflow) or npm install failure. Fix, re-run.
- **Wrong tag pushed:** `git tag -d 1.0.0 && git push origin :refs/tags/1.0.0` to delete locally + remote, then re-tag and push.
- **Release created with bad notes:** `gh release edit 1.0.0 --notes-file <path>` replaces the body.
- **Attestation missing:** `gh attestation download --repo JordanNewell/curtis-ai-chat 1.0.0` to fetch + attach retroactively.
- **Old `curtis` plugin users howling in the forum:** reply with the migration recipe, offer to help in DMs, link the release notes section on reinstalling.
