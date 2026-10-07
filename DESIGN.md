# Curtis Visual Design Brief — October 2026

Palette and visual-language spec for the Curtis new look. Evidence-based: built from
Obsidian ecosystem research (official developer docs, competitor stylesheets, community
sentiment) and mainstream AI-chat design analysis (ChatGPT, Claude, Gemini, Perplexity,
Copilot, Grok). Cross-checked against the NEWELL Brand System (`e:/vaults/newell/10_PROJECTS/brand-system/`).

## The core rule: two surfaces, two palettes

1. **Plugin UI (in-Obsidian chrome)** — inherit the user's theme via Obsidian CSS
   variables. Never force the NEWELL palette into in-app chrome. Official Obsidian
   guidelines, the community review tooling, and every market-leading competitor agree;
   plugins that break theming get bug reports within days (Pieces issue #333 precedent).
2. **Brand surfaces (docs site, hero/OG art, README, screenshots, marketplace copy)** —
   NEWELL Brand System verbatim. The docs site already complies.

The green lives in marketing and in *brand moments* (iconography, the N badge, staged
screenshots with a green-accented theme), not in painted-over UI chrome.

## Market findings (what the market wants, Oct 2026)

Obsidian ecosystem:
- Theme inheritance is table stakes. Style from `--background-*`, `--text-*`,
  `--interactive-accent`, `--radius-s/m/l`, `--font-ui-*`. Hardcoded values read as legacy
  (BMO's `#282c34`) or generate bug reports (Pieces #333, fixed within days).
- The two best-regarded plugin UIs — Copilot for Obsidian and Smart Composer — both use
  **flat document-style messages** (stacked turns, subtle user-message differentiation).
  True left/right messenger bubbles survive only in the oldest design (Smart Connections).
- Input convention: `--background-modifier-form-field` + `--background-modifier-border`
  + `--radius-s`/`--radius-m` + `--background-modifier-border-focus` focus ring.
- Obsidian default radii: `--radius-s` 4px, `--radius-m` 8px, `--radius-l` 12px, `--radius-xl` 16px.
  Default accent is a violet `hsl(254, 80%, 68%)`; the user's accent is the only accent.

Mainstream AI chat:
- Near-black neutral darks (`#0A0A0A`–`#212121`) and warm off-whites; **one confident flat
  accent** (Claude terracotta, Perplexity turquoise, Grok orange). Gradient accents exist
  (Gemini, Copilot) but read as the loud end of the market.
- Layout consensus: **user input in a bubble/pill, AI output flat full-width** — no mainstream
  product uses symmetric dual messenger bubbles anymore.
- Type trend: sans for chrome, editorial/serif voice for AI output (Tiempos/anthropicSerif,
  PP Editorial New). In-Obsidian equivalent: assistant prose in `--font-text-theme` (the
  vault's own text font), chrome in `--font-interface-theme`.
- Radii: pill composers universal; cards/code 12–16px; Claude most restrained at 8–12px.

## Brand palette (marketing + brand moments — verbatim NEWELL tokens)

| Token | Hex | Role |
|---|---|---|
| background | `#0A0A0A` | OLED soft black — page/canvas |
| surface | `#0F0F0F` | Cards on background |
| text | `#FFFFFF` | Body copy, primary type |
| muted | `#A0A0A0` | Secondary copy (never primary) |
| border | `#1F1F1F` | Card/edge definition (no shadows for depth) |
| primary | `#00FF41` | The green — solid fills, accents, CTAs |
| accent | `#1AFF72` | Accent lift — discrete fills beside primary, never blended (no gradients) |

Constraints:
- No color outside this set on NEWELL surfaces. No pure `#000000`, no pure `#00FF00`,
  no indigo/violet, no Inter.
- Green on white fails contrast (~1.4:1): on light surfaces green is for oversized display
  glyphs and fills only, never body text.
- No gradients, no glow/bloom, no glassmorphism, no soft-shadow elevation, no emoji-as-UI.
- 8px spacing grid: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128]. ≥30% negative space.

## Typography

| Context | Face | Notes |
|---|---|---|
| "CURTIS" wordmark, hero display | **Space Grotesk** Medium/SemiBold/Bold | Per `tokens.json` `display_hero`; Newell v0.1 is reserved for the literal "NEWELL" wordmark/N mark only |
| Technical, code, version strings | **JetBrains Mono** | Docs site already uses this throughout |
| Plugin chrome | `--font-interface-theme` | Native look |
| Assistant prose (in-plugin) | `--font-text-theme` | Mirrors the sans-chrome/editorial-AI-output trend via the vault's own font |
| Code (in-plugin) | `--font-monospace-theme` | Already correct |

## Radius

| Surface | Radius |
|---|---|
| Brand scale | 4 / 8 / 12 / 20 (9999 for marketing pills) |
| Plugin controls, badges, chips, inline code | `--radius-s` (4px) |
| Plugin cards, menus, composer, user-message card, arena columns | `--radius-m` (8px) |
| Plugin modals, code blocks, diff panes | `--radius-l` (12px) |

Current `src/styles.css` uses 18/16/14/12/10/8/6/4 ad hoc — snap everything onto the token
scale above.

## In-plugin new look (layout direction)

- **Flat document-style conversation**: assistant prose renders full-width on the panel
  background (markdown through Obsidian's own pipeline). Kill the dual-bubble messenger
  layout and the asymmetric 18px bubble tails.
- **User turn**: compact card on `--background-secondary` (or `--background-modifier-hover`),
  `--radius-m`, right-constrained max-width — the Copilot/Smart Composer pattern, which
  also matches the mainstream "user in card, AI flat" consensus.
- **Composer**: Obsidian form-field convention — `--background-modifier-form-field`
  background, `--background-modifier-border` border, `--radius-m`, focus ring in
  `--background-modifier-border-focus`. Circular send FAB survives (universal across
  mainstream products; keep `--interactive-accent` fill).
- **Remove brand violations that also date the UI**: the radial-gradient empty-state orb
  glow (anti-patterns "too much glow" + "decorative gradients"), provider-dot glow
  shadows → solid `--provider-color` dots. Emphasis via weight/isolation, not luminance.
- **Empty state**: brand moment — Curtis mark on `--background-secondary` ring, icon color
  `--interactive-accent` (respects the user's theme; green version is the staged
  screenshot/marketing variant).
- **Motion**: state-driven only, under 300ms, nothing animating while idle (already
  largely true; drop the infinite-pulse accents where they're purely atmospheric).

## What not to do

- Do not paint the plugin chrome green/black — theme inheritance wins in-app.
- Do not set "CURTIS" in the Newell face (v0.1 alpha: S reads as Z, C/D/O rectilinear).
- Do not introduce any hex outside `tokens.json` on brand surfaces.
- Do not hand-edit `styles.css` values off the `--radius-*` / spacing token scales.

## Evidence (primary sources)

- Obsidian developer docs: CSS variables (Radiuses, Colors, Typography), About styling,
  Plugin guidelines ("No hardcoded styling"), Obsidian October self-critique checklist —
  github.com/obsidianmd/obsidian-developer-docs
- Competitor stylesheets (fetched Oct 2026): logancyang/obsidian-copilot (Tailwind→Obsidian
  variable bridge, flat layout), glowingjade/obsidian-smart-composer (fully
  variable-driven, flat layout, form-field input), brianpetro/obsidian-smart-connections
  (1.5rem bubbles — oldest design), longy2k/obsidian-bmo-chatbot (hardcoded `#282c34`,
  5px radii — the cautionary tale), nhaouari/obsidian-textgenerator-plugin, brumik/obsidian-ollama-chat
- Sentiment: Pieces support issue #333 (theme non-compliance treated as bug, fixed in
  days); Obsidian forum "make custom plugin UI look native"; Style Settings ecosystem
- Mainstream products: OpenAI 2025 rebrand (OpenAI Sans, #212121 dark, monochrome chrome);
  Anthropic (ivory #FAF9F5/#F4F3EE, Crail #D97757, Styrene+Tiempos→anthropicSerif);
  Perplexity 2026 brand standards (#091717, True Turquoise #20808D, PPLX type system);
  xAI Grok (#0A0A0A Jet Ink, orange #FF6308); Google M3 Expressive; Microsoft Fluent 2 /
  2026 M365 Copilot redesign
