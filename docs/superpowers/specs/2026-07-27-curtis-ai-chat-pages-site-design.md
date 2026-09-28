# Curtis AI Chat — GitHub Pages Site (design)

**Date:** 2026-07-27
**Status:** Approved (mockup reviewed)
**Owner:** Jordan Newell
**Scope:** Ship a single-page product site at `https://jordannewell.github.io/curtis-ai-chat/`

---

## Why

`curtis-ai-chat` is the first product in a planned Curtis AI line (per `docs/MONETIZATION.md`). The repo has no public-facing site — the Obsidian community listing and GitHub README are the only entry points. We need a destination we can:

- Link from the splash badge on `jordannewell.com` (currently `display:none` until a URL exists)
- Put in release notes, social posts, and future product teases
- Use as the canonical home for the upcoming "Curtis AI Research" line, without standing up separate infrastructure yet

The site must feel "sexier" than the fleet baseline (git-hygiene Pages) because Curtis AI is a brand we intend to zoom into a product — but it must not oversell a free OSS plugin.

## Goals / non-goals

**Goals:**
- Single self-contained `docs/index.html` (~700 lines) — inline CSS, zero JS dependencies, zero build step.
- Match fleet brand: black `#000` + white + Newell green `#3FFF46` (per `reference_brand-colors-black-white-neon-green`), Newell typeface via the existing newell-typeface Pages.
- Tease "Curtis AI Research" with a dedicated, visually distinct block — without email capture or "notify me" infrastructure (monetization signals haven't fired).
- Match the git-hygiene deployment model exactly: GitHub Pages serving from `/docs` on `master`, no Actions workflow.
- Be readable, scrollable, mobile-friendly, and have one clear primary CTA (Install).

**Non-goals:**
- No multi-page site, no Jekyll, no Astro, no SSG.
- No analytics, no email capture, no Stripe, no Discord widget.
- No new branding exercise — reuse Newell typeface, fleet palette, existing `assets/hero.png`.
- No testimonials / social proof (signals haven't fired; absence is more credible than fabrication).
- No AI-attribution trailer anywhere (per `CLAUDE.md`).
- No email address in the footer (per `feedback_no-email-in-footer`).

## Visual direction (chosen: A · Console)

Three directions were considered; the rejected two are documented in `.superpowers/brainstorm/<session>/content/directions.html` and `console-fullpage.html` for posterity.

- **A · Console (CHOSEN)** — elevated brutalist terminal. Same Newell terminal bones as git-hygiene, plus a feature grid, scrolling provider marquee, and a dashed-border "RESEARCH INITIALIZING" block.
- ~~B · Lab~~ — spatial 3D scattered keycaps, hovering glass terminal. Rejected: high lift, oversells a free OSS plugin.
- ~~C · Manifesto~~ — editorial product-launch with provider logo wall and notify CTA. Rejected: notify-capture is infrastructure that's not needed yet.

**Why A:** fleet-consistent, ships in one file, "sexy" comes from polish (animated cursor, marquee, radar pulse, glow) rather than scope. B and C both reach for product-launch energy that doesn't match a v1.0.3 BYOK plugin whose job is maximum adoption.

## Architecture

### Deployment

- GitHub Pages, **classic source**: `/docs` directory on `master` branch.
- URL: `https://jordannewell.github.io/curtis-ai-chat/`.
- No Actions workflow. Pages serves static files natively.
- Page must work without JS (all animations are CSS; degraded state is still fully readable).

### Filesystem

```
curtis-ai-chat/
  docs/
    index.html        ← the entire site (single file, ~700 lines)
    assets/
      favicon-32.png  ← nS favicon (provided by Jordan 2026-07-27, 1374 bytes)
  .gitignore          ← add .superpowers/ entry (already done for this brainstorm)
```

### External dependencies (all Jordan-controlled)

| Asset | Source | Reason |
|---|---|---|
| Newell font (`Newell-Regular.woff2`) | `https://jordannewell.github.io/newell-typeface/releases/Newell-Regular.woff2` | Fleet consistency; avoids font files in repo |
| Favicon (32) | `docs/assets/favicon-32.png` (local, served from same Pages root) | nS mark provided by Jordan 2026-07-27; replaces the newell-typeface favicon fleet default |
| Favicon (512, apple-touch) | `https://jordannewell.github.io/newell-typeface/assets/favicon-512.png` + `apple-touch-icon.png` | Fleet fallback for the sizes Jordan hasn't yet provided; can be replaced 1:1 if/when larger `nS` variants exist |
| `og:image` | `https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/hero.png` | Same URL the README uses; Pages serves `/docs` so the Pages URL space can't reach `assets/` at repo root — `raw.githubusercontent.com` is the canonical public URL for this asset |
| Provider list / copy | Pulled from current `manifest.json` + `README.md` | Single source of truth |

### Page sections (in order, top→bottom)

1. **Sticky topbar**
   - Left: `CURTIS·AI` Newell wordmark + `SYSTEM ONLINE` mono status (green dot).
   - Right: nav (`Features` · `Providers` · `Research` · `Install` · `GitHub ↗`).
   - Sticky, `rgba(0,0,0,0.92)` + `backdrop-filter: blur(8px)`, bottom border `--rule`.

2. **Hero**
   - Kicker: `▒ v1.0.3 · Obsidian plugin · MIT` (mono, green, letter-spaced).
   - Headline: `CURTIS·AI` in Newell, `clamp(3.5rem, 9vw, 6.5rem)`, green middle dot accent.
   - Tagline: `Polyglot AI chat for Obsidian. Thirty-plus providers, one sidebar. Your vault stays yours.` + blinking green cursor block.
   - CTAs: `⬇ Install` (primary green) → GitHub releases; `View source ↗` → repo; `Obsidian ↗` → community listing.
   - Signal stats row: `30+ providers · 9 agent tools · 0 warnings · BYO keys`.

3. **`01 · Features`** — 8 feature cards in 4-col grid (2-col tablet, 1-col mobile).
   - Each card: mono symbol (🤖/⚔/⌫/@/🎙/⌕/⤓/🧠), Newell title, plain-language description, mono ID stamp (`AGENT·01` … `MEMORY·08`).
   - Hover: border lightens to `--green-line`, background tints `rgba(63,255,70,0.04)`.
   - Card content sourced directly from README's 8 flagship features — no embellishment.

4. **`02 · Providers`** — infinite-scroll marquee.
   - Container has edge gradient masks so providers fade in/out at both ends.
   - Marquee content: ~16 provider names, duplicated for seamless loop. "Hot" providers (Anthropic, Gemini, Mistral, xAI) rendered in green.
   - Animation: `transform: translateX(0 → -50%)`, 40s linear infinite, pauses on `prefers-reduced-motion`.
   - Meta strip below: `30+ providers / BYOK keys in OS keychain / Local offline`.

5. **`03 · Coming next` — the Research tease block** (see "Tease mechanics" below).

6. **`04 · Quick start`** — 3 install cards (Install / Configure / Send) sourced from README's "60 seconds to your first message" section.
   - Below: small mono note about the Ollama offline path with the `ollama pull qwen2.5:7b-instruct` command.

7. **Footer**
   - Mono, uppercase, letter-spaced.
   - Links: GitHub · Releases · Discussions · Buy me a coffee · Sponsor.
   - Right side: `Curtis AI · MIT · by Jordan Newell`.
   - **No email** (per `feedback_no-email-in-footer`).
   - **No AI-attribution trailer** (per `CLAUDE.md`).

### Tease mechanics (`03 · Coming next`)

A single `.research` block, visually distinct from the rest of the page:

- **Border:** `1px dashed var(--green-line)` — the only dashed border on the page, signals "in progress".
- **Background:** `var(--bg-2)` + radial-gradient glow from top center (`rgba(63,255,70,0.06)` → transparent at 60%).
- **Scan label:** `▒ RESEARCH INITIALIZING` with a pulsing green radar dot (8px, `box-shadow: 0 0 12px var(--green)`, `pulse 1.4s ease-in-out infinite`).
- **Headline:** `Curtis AI · Research` in Newell (`clamp(1.8rem, 4vw, 2.8rem)`), middle dot dimmed.
- **Body copy:** *“Curtis AI Chat is step one. The next thing is built for people who treat their vault like an operating system — research-grade tools for thinking, writing, and finding patterns across years of notes.”*
- **Typing line:** `▒ calibrating scope█` — green mono, blinking green cursor (not animated typing, just the cursor — keeps the CSS-only promise).
- **CTAs:** `★ Watch the repo ↗` → `https://github.com/JordanNewell/curtis-ai-chat` (the repo root; GitHub's "Watch" is a UI action the user performs on that page). `Back the build ↗` → `https://github.com/sponsors/JordanNewell`. Both go to existing rails — no new infrastructure.

**Why no email capture:** per `project_curtis-ai-chat-monetization-strategy-2026-07-23`, the trigger for standing up a Discord + mailing list is ~500 stars / ~2K DAU. Until then, GitHub star + Sponsors are the existing rails, and the site shouldn't promise infrastructure that doesn't exist.

## Copy decisions

- **Wordmark:** `CURTIS·AI` with green middle dot. Chosen over `CURTIS AI` / `curtis//ai` / `CURTIS—AI` for: matches the splash-badge DNA already on `jordannewell.com` (`cs-curtis` element), single-character separator reads cleaner at small sizes, the green dot doubles as the "AI is online" signal.
- **Tagline ends with the privacy hook:** *"Your vault stays yours."* is the most important differentiator vs. hosted AI tools — it earns the final-period slot.
- **"Curtis AI Research" is named explicitly** (not "something coming"). Per Jordan's prompt, this is the brand we're zooming into; being explicit is the point.
- **Section numbering** (`01 · Features` … `04 · Quick start`) matches the mono-brutalist tone and gives readers a sense of scale at a glance.

## Accessibility

- All animations respect `prefers-reduced-motion` (marquee pauses, cursor stops blinking, pulse stops).
- Color contrast: white-on-black is 21:1 (AAA). `--dim` (`#a0a0a0`) on black is ~9.7:1 (AAA). `--muted` (`#5a5a5a`) on black is ~3.7:1 — used only on non-essential meta text, never body copy.
- All interactive elements are `<a>` tags with clear focus states (browser default, plus border-color transition on hover).
- Newell font has `font-display: swap` so FOIT doesn't block render.

## SEO / social

- `<title>`: `Curtis AI Chat — polyglot AI chat for Obsidian. 30+ providers, one sidebar.`
- `<meta name="description">`: same tagline.
- OpenGraph + Twitter card tags pointing to `og:image` = `https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/hero.png` (see "External dependencies" for why not the Pages URL).
- `<link rel="canonical">` → `https://jordannewell.github.io/curtis-ai-chat/`.
- Theme-color: `#000000`.

## Testing plan

- **Visual:** open `docs/index.html` directly in browser (file://) to confirm it renders without a server. Then push to `master`, confirm Pages build succeeds at the URL.
- **Responsive:** test at 320 / 480 / 768 / 1024 / 1440 widths. Features grid collapses 4→2→1; steps collapse 3→1; marquee edge-masks still work; topbar nav doesn't overflow.
- **Font fallback:** confirm `Newell` fails to load (block the URL) → page still renders in `system-ui` fallback, layout doesn't break.
- **Accessibility:** confirm `prefers-reduced-motion` stops marquee + cursor + pulse.
- **Links:** every link goes where it claims (releases, repo, community listing, BMAC, Sponsors, newell-typeface font URL).
- **SEO:** paste URL into OpenGraph debugger (or curl the HTML) — confirm OG tags resolve to the right image.

## Risks

| Risk | Mitigation |
|---|---|
| Pages build fails (master branch protection, wrong source) | Confirm Pages source set to `master` / `/docs` in repo settings before expecting it to live. Settings are a manual step outside this code change. |
| Newell font URL changes (newell-typeface repo refactor) | Font URL has been stable since 2026-07-25 ship; if it moves, it breaks the whole fleet, not just this site. Acceptable risk. |
| Hero PNG looks dated in 6 months | Out of scope — we ship with what's in `assets/`. Revisit when v1.1 ships. |
| "Curtis AI Research" copy overpromises | Deliberately vague ("research-grade tools for thinking, writing, and finding patterns"); names no specific feature, no date. Safe to ship. |
| Provider list drifts from actual manifest | Marquee is hard-coded HTML, not generated. Note in CHANGELOG to revisit when v1.1 adds providers. Acceptable for a v1.0.3-era site. |

## Out of scope (deferred)

- Mobile-native scattered-keycap fallback (Direction B energy) — re-evaluate when v1.1 ships
- Provider logo wall (Direction C) — re-evaluate when adoption signals fire
- Email capture / notify-me / Discord widget — deferred per monetization memory
- Multi-language — English only at v1.0.x
- Curtis AI Research landing page — separate project when the time comes
