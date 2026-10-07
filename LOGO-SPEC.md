# Curtis Logo — Asset Specification for Graphic Design

Handoff spec for the Curtis in-app logo disc (the chat empty-state hero).
The current mark (`assets/logo-source.jpg`, a neon-green "C" on black) is a
placeholder; this document defines what the final master must satisfy.

Brand system: NEWELL (`e:/vaults/newell/10_PROJECTS/brand-system/`).
Visual rules: `DESIGN.md` (Oct 2026 brief). When the two conflict on a point
below, this spec wins for this asset.

## Where it appears

- **Primary use**: center of the Curtis chat panel (Obsidian plugin), shown
  above the "Curtis" title on a new/empty chat. Rendered as a **circle-cropped
  disc**: 96 px on desktop, 72 px on phones, with a thin theme border and an
  8 px soft ring from the surrounding UI. **Theme-adaptive**: dark user themes
  show the dark master, light themes show the light master (the swap is a CSS
  rule; both masters must be geometrically identical so the mark never shifts).
- **Not used for**: the sidebar ribbon icon and tab icon (Obsidian only allows
  vector Lucide glyphs there), or the website hero/OG art (separate assets).

## Deliverable 1 (required) — two square masters, dark + light

Both masters share every spec below **except background color**; the mark's
geometry, position, and safe area must be pixel-identical between them.

| Spec | Value |
|---|---|
| Canvas | Exact square, 1024 × 1024 px, PNG (24-bit or 32-bit), one file per master |
| Dark master bg | **Full-bleed `#0A0A0A`** — NEWELL soft black. NOT `#000000`. Corners will be cropped by the circle; fill edge to edge |
| Light master bg | **Full-bleed `#F5F5F3`** — flat warm off-white (matches the CSS fallback). Same full-bleed requirement |
| Mark color | **`#00FF41`** primary in both masters (`#1AFF72` accent lift allowed as a discrete second fill — never blended, no gradients). Green-on-light is acceptable here because the mark is an oversized display glyph, not text |
| Safe area | All critical geometry inside an inscribed **circle at 70% of canvas width** (≈717 px diameter, centered). The current placeholder's mark-to-canvas ratio (~75% after our crop) is the ceiling; aim for 65–70% |
| Centering | Optically centered (a mark with a tail, like the current C, may sit slightly high so the *visual mass* centers) |
| Style | Flat, monoline/geometric, engineering aesthetic. No gradients, no glow/bloom, no shadows, no bevels, no glassmorphism, no emoji |
| Stroke weight | Must stay legible at 48 px rendered size — test by shrinking to 48 px; fine detail and thin strokes will smear |
| Type | If the mark is a letterform: do NOT set it in the Newell v0.1 face (its C/D/O are rectilinear alpha quirks — reserved for the NEWELL wordmark anyway). "CURTIS" wordmark contexts use Space Grotesk; a drawn logomark is preferred over a typed one |
| Negative space | ≥30% of the canvas |
| Palette | Nothing outside `tokens.json` (`#0A0A0A`, `#0F0F0F`, `#FFFFFF`, `#A0A0A0`, `#1F1F1F`, `#00FF41`, `#1AFF72`) **plus** the light master's `#F5F5F3` canvas — the single sanctioned non-token value here (NEWELL tokens are dark-surface-only; warm off-white per DESIGN.md) |

## Deliverable 2 (optional but requested) — mark-only vector

- SVG of the mark alone, transparent background, single color `#00FF41`
  (outline/stroke form is fine). Future use: site, OG art, dark/light theming,
- 1024 px equivalent viewBox, same safe-area proportions.

## Technical constraints (why the specs above are hard)

- Plugin releases ship **only** `main.js` + `styles.css` — no image files. Each
  master is downscaled to 288 × 288, JPEG-compressed, and inlined as a base64
  data URI in `styles.css` (two URIs, swapped by theme). Budget: **≤ 60 KB**
  compressed per master at 288 px (flat two-color art compresses to ~6 KB, so
  this is generous).
- The disc is cropped by CSS `border-radius: 50%` — square corners of the
  master never render, but must still be `#0A0A0A` so compression stays clean.
- Retina: 288 px master renders sharp at 2× the 96/72 px display sizes.

## Handoff process (repo side)

1. Designer delivers the two 1024 PNG masters (dark + light).
2. Save as `assets/logo-source.jpg` (dark) and
   `assets/logo-source-light.jpg` (light) — PNG content despite the names, or
   update the extensions and script defaults.
3. `powershell scripts/logo-crop.ps1` — square-crops the dark master to
   `assets/logo-square.jpg` (and, for the interim placeholder only, derives a
   light variant; pass `-NoDeriveLight` when a real light master exists).
4. `powershell scripts/logo-crop.ps1 -In assets/logo-source-light.jpg -Out assets/logo-square-light.jpg -NoDeriveLight`
   — crops the light master.
5. `node scripts/inline-logo.mjs` — re-inlines both data URIs into
   `src/styles.css`.
6. `npm run build` and eyeball the empty chat state in the demo vault, in both
   light and dark themes.
