# Curtis AI Chat v1.0.0 — Launch Kit

Complete promo package for the v1.0.0 ship. All artifacts ready to paste; no further drafting needed.

## Sequence

1. **`00-launch-checklist.md`** — full launch-day runbook. Phases A through J, sequenced. Start here.
2. **`10-release-notes.md`** — curated GitHub Release body. Paste after `release.yml` auto-creates the release.
3. **`20-community-submission.md`** — community.obsidian.md dashboard text + cover letter.
4. **`30-show-hn.md`** — Hacker News Show HN post. Title + first-comment body.
5. **`40-reddit-obsidianmd.md`** — r/ObsidianMD post. Title + body.
6. **`50-twitter.md`** — single tweet + 6-tweet thread + comparison companion.
7. **`60-discord-obsidian.md`** — Obsidian Discord #showcase message.
8. **`70-brat-listing.md`** — BRAT install string (skip the curated-list PR unless you want discoverability).

## Channel-by-channel posting order

On launch day, post in this order so each channel can link the next:

1. Twitter/X thread (pin for 48h)
2. Reddit /r/ObsidianMD
3. Hacker News Show HN (best Tue–Thu 7:30–9:30am PT)
4. Obsidian Discord
5. Mastodon cross-post

Space 15–30 min between posts so you can engage with early replies, not all at once.

## What's locked

- Plugin ID: `curtis-ai-chat`
- Tag: `1.0.0` (no `v` prefix — Obsidian submission rule)
- Repo URL target: `https://github.com/JordanNewell/curtis-ai-chat`
- Local folder: `E:/dev/projects/curtis-ai-chat/` (already renamed)
- Manifest description: starts with "Polyglot", no "Obsidian" mention (Obsidian submission rule)
- All release assets get Sigstore attestations from `release.yml`

## What's already done (don't redo)

- README badge URLs + hero img URL → `curtis-ai-chat`
- README BRAT tip updated to mention directory + manual + BRAT
- CONTRIBUTING clone URL → `curtis-ai-chat`
- Hero banner rendered via Playwright (S393, commit `69de5cd`)
- CHANGELOG.md polished, dated 2026-07-22
- `manifest.json`, `package.json`, `versions.json` all at 1.0.0
- v1.0.0 release commit `659de17` local on master (3 commits ahead of origin)

## What's NOT in this kit

- **Video demo.** If you want one for Twitter/Reddit, record a 60-90s screencast: open chat → send msg → trigger agent tool → open arena → diff rewrite. Higher impact than text-only.
- **OG/social preview image.** `social-preview.png` was generated for curtis-compliance and temporal-git in S393 but NOT for curtis-ai-chat. Optional; upload via GitHub repo settings → Social preview. Affects link-unfurl cards on Twitter/Slack/Discord.
- **Mastodon/Lemmy variants.** Mastodon can reuse the Twitter thread + hashtags. Lemondmlemmy /r/selfhosted cross-post can reuse the HN text.
- **LinkedIn announce.** Skipped — different audience, write fresh if you want it.
