# Curtis AI Chat Pages Site — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single-page product site for the curtis-ai-chat Obsidian plugin at `https://jordannewell.github.io/curtis-ai-chat/`, including a visually distinct "Curtis AI Research is coming" tease block.

**Architecture:** One self-contained `docs/index.html` (inline CSS, zero JS, zero build step) served by GitHub Pages from the `/docs` directory on `master`. Fonts and large favicons are pulled from the existing newell-typeface Pages; the 32px favicon is local (`docs/assets/favicon-32.png`, already staged); the `og:image` is the same `raw.githubusercontent.com` URL the README uses. The visual direction is "A · Console" — elevated brutalist terminal matching the fleet baseline (black + white + `#3FFF46` Newell green).

**Tech Stack:** HTML5, CSS3 (custom properties, flex/grid, keyframe animations, `prefers-reduced-motion`), Newell typeface. No JavaScript. No frameworks. No SSG.

**Spec:** [`docs/superpowers/specs/2026-07-27-curtis-ai-chat-pages-site-design.md`](../specs/2026-07-27-curtis-ai-chat-pages-site-design.md)

---

## File Structure

| Path | Purpose | Status |
|---|---|---|
| `docs/index.html` | The entire site | **CREATE** in this plan |
| `docs/assets/favicon-32.png` | nS favicon (1374 bytes) | Already staged (2026-07-27) |
| `docs/assets/` (dir) | Container for Pages-served binary assets | Already exists |
| `.gitignore` | Must include `.superpowers/` | Already has entry (2026-07-27) |
| `.nojekyll` | Disables Jekyll on Pages (so `_layouts`-style paths aren't filtered) | **CREATE** — defensive, takes 5 seconds |

Each task below adds a contiguous slice of `docs/index.html`. Tasks 1–8 each leave the file in a committable state (renders without errors, all referenced CSS defined). Task 9 is final QA. Task 10 is the deploy step.

**Testing strategy:** HTML/CSS has no unit-test framework. Each task's verification is:
1. **Open** `docs/index.html` directly in the browser via `file://` (no server needed — all resources are absolute URLs or local relative paths).
2. **Visually confirm** the section renders correctly at desktop width (≥1024px).
3. **Console check** — no 404s, no font-load failures.
4. **Responsive check** — at least one mobile width (375px) per task that adds responsive behavior.

For accessibility: Task 9 includes a `prefers-reduced-motion` check.

---

## Pre-flight: confirm baseline state

- [ ] **Step 0.1: Confirm favicon is staged**

Run: `ls -la E:/dev/projects/curtis-ai-chat/docs/assets/favicon-32.png`
Expected: file exists, ~1374 bytes.

- [ ] **Step 0.2: Confirm `.gitignore` includes `.superpowers/`**

Run: `grep -n "^.superpowers/" E:/dev/projects/curtis-ai-chat/.gitignore`
Expected: at least one matching line. (Already added during brainstorming.)

- [ ] **Step 0.3: Confirm spec exists**

Run: `ls E:/dev/projects/curtis-ai-chat/docs/superpowers/specs/2026-07-27-curtis-ai-chat-pages-site-design.md`
Expected: file exists.

If any of these fail, stop and remediate before proceeding.

---

### Task 1: HTML skeleton + head + base CSS

**Files:**
- Create: `docs/index.html`

This task produces a renderable but blank page. Browser should show: black background, Newell font loaded (check Network tab — 200 on the woff2), title set, meta tags present, empty body.

- [ ] **Step 1.1: Write the file head + base styles**

Create `E:/dev/projects/curtis-ai-chat/docs/index.html` with exactly this content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#000000">
  <meta name="description" content="Curtis AI Chat — polyglot AI chat for Obsidian. 30+ providers, one sidebar. Your vault stays yours.">
  <meta name="author" content="Jordan Newell">
  <meta property="og:title" content="Curtis AI Chat — polyglot AI chat for Obsidian">
  <meta property="og:description" content="30+ providers, one sidebar. Your vault stays yours.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://jordannewell.github.io/curtis-ai-chat/">
  <meta property="og:image" content="https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/hero.png">
  <meta property="og:site_name" content="Curtis AI">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Curtis AI Chat — polyglot AI chat for Obsidian">
  <meta name="twitter:description" content="30+ providers, one sidebar. Your vault stays yours.">
  <meta name="twitter:image" content="https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/hero.png">
  <title>Curtis AI Chat — polyglot AI chat for Obsidian. 30+ providers, one sidebar.</title>
  <link rel="canonical" href="https://jordannewell.github.io/curtis-ai-chat/">
  <link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">
  <link rel="icon" type="image/png" sizes="512x512" href="https://jordannewell.github.io/newell-typeface/assets/favicon-512.png">
  <link rel="apple-touch-icon" href="https://jordannewell.github.io/newell-typeface/assets/apple-touch-icon.png">
  <style>
    @font-face {
      font-family: "Newell";
      src: url("https://jordannewell.github.io/newell-typeface/releases/Newell-Regular.woff2") format("woff2");
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }

    :root {
      --bg:           #000000;
      --bg-2:         #0a0a0a;
      --green:        #3FFF46;
      --green-soft:   rgba(63, 255, 70, 0.08);
      --green-line:   rgba(63, 255, 70, 0.25);
      --green-glow:   rgba(63, 255, 70, 0.18);
      --text:         #e8e8e8;
      --dim:          #a0a0a0;
      --muted:        #5a5a5a;
      --rule:         #1a1a1a;
      --sans:         system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      --mono:         ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      font-size: 16px;
      line-height: 1.6;
      font-weight: 400;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      overflow-x: hidden;
      min-height: 100vh;
    }

    a {
      color: var(--green);
      text-decoration: none;
      border-bottom: 1px solid transparent;
      transition: border-color 0.15s ease, color 0.15s ease;
    }
    a:hover { border-bottom-color: var(--green); }

    .page { max-width: 1100px; margin: 0 auto; padding: 0 1.5rem; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        scroll-behavior: auto !important;
      }
    }
  </style>
</head>
<body>
  <!-- sections added in subsequent tasks -->
</body>
</html>
```

- [ ] **Step 1.2: Verify it renders**

Open `file:///E:/dev/projects/curtis-ai-chat/docs/index.html` in the browser.
Expected: black page, no console errors, title bar shows "Curtis AI Chat — polyglot AI chat for Obsidian. 30+ providers, one sidebar.", Network tab shows the Newell woff2 loading 200 OK.

- [ ] **Step 1.3: Commit**

```bash
cd E:/dev/projects/curtis-ai-chat
git add docs/index.html docs/assets/favicon-32.png docs/.nojekyll 2>/dev/null || git add docs/index.html docs/assets/favicon-32.png
# Note: .nojekyll is added in Task 10 — do not stage it here unless it already exists.
git add docs/index.html docs/assets/favicon-32.png
git commit -m "feat(site): scaffold curtis-ai-chat pages site with base styles"
```

Expected: one commit on `master`.

---

### Task 2: Topbar

**Files:**
- Modify: `docs/index.html` — append `<style>` block extension and inject topbar `<div>` into `<body>`

- [ ] **Step 2.1: Add topbar CSS**

In `docs/index.html`, find the line `</style>` (inside `<head>`). Insert this block **immediately before** `</style>`:

```css
    /* ---------- top bar ---------- */
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.1rem 1.5rem;
      border-bottom: 1px solid var(--rule);
      position: sticky;
      top: 0;
      background: rgba(0, 0, 0, 0.92);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 50;
    }
    .topbar .left { display: flex; gap: 1.4rem; align-items: center; }
    .topbar .brandmark {
      font-family: "Newell", system-ui;
      font-size: 0.95rem;
      color: var(--text);
      letter-spacing: -0.02em;
      text-transform: none;
      line-height: 1;
    }
    .topbar .brandmark .dot { color: var(--green); }
    .topbar .status {
      font-family: var(--mono);
      font-size: 0.72rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .topbar .status b { color: var(--green); font-weight: 600; }
    .topbar nav { display: flex; gap: 1.2rem; }
    .topbar nav a {
      font-family: var(--mono);
      font-size: 0.72rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--dim);
      border: none;
    }
    .topbar nav a:hover { color: var(--green); }

    @media (max-width: 640px) {
      .topbar nav { display: none; }
    }
```

- [ ] **Step 2.2: Inject topbar markup**

Find the line `<!-- sections added in subsequent tasks -->` inside `<body>`. Replace that comment with:

```html
    <div class="topbar">
      <div class="left">
        <span class="brandmark">CURTIS<span class="dot">·</span>AI</span>
        <span class="status">SYSTEM <b>ONLINE</b></span>
      </div>
      <nav>
        <a href="#features">Features</a>
        <a href="#providers">Providers</a>
        <a href="#research">Research</a>
        <a href="#install">Install</a>
        <a href="https://github.com/JordanNewell/curtis-ai-chat">GitHub ↗</a>
      </nav>
    </div>
```

- [ ] **Step 2.3: Verify**

Refresh `file:///E:/dev/projects/curtis-ai-chat/docs/index.html`.
Expected:
- Black sticky bar across the top with `CURTIS·AI` (green dot) on the left, `SYSTEM ONLINE` (green ONLINE) next to it.
- Nav links on the right: Features / Providers / Research / Install / GitHub ↗.
- Bar stays visible when you scroll (there's nothing to scroll yet — verify with DevTools by setting body min-height to 200vh temporarily, then revert).
- At window width ≤640px, nav disappears (mobile).

- [ ] **Step 2.4: Commit**

```bash
cd E:/dev/projects/curtis-ai-chat
git add docs/index.html
git commit -m "feat(site): add sticky topbar with brandmark and nav"
```

---

### Task 3: Hero

**Files:**
- Modify: `docs/index.html` — append hero CSS, append hero `<header>` after topbar

- [ ] **Step 3.1: Add hero CSS**

Insert this block immediately before `</style>`:

```css
    /* ---------- hero ---------- */
    .hero {
      padding: 6rem 0 4rem;
      border-bottom: 1px solid var(--rule);
    }
    .hero .kicker {
      font-family: var(--mono);
      font-size: 0.72rem;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--green);
      margin-bottom: 1.5rem;
    }
    .hero .kicker::before { content: "▒ "; }
    .hero h1 {
      font-family: "Newell", system-ui;
      font-size: clamp(3.5rem, 9vw, 6.5rem);
      line-height: 0.95;
      letter-spacing: -0.03em;
      color: #ffffff;
      margin-bottom: 1.2rem;
    }
    .hero h1 .accent { color: var(--green); }
    .hero .tag {
      font-size: clamp(1.05rem, 1.5vw, 1.25rem);
      color: var(--dim);
      max-width: 580px;
      margin-bottom: 2.5rem;
    }
    .hero .tag .cursor {
      display: inline-block;
      width: 10px;
      height: 1em;
      background: var(--green);
      vertical-align: -2px;
      margin-left: 3px;
      animation: blink 1.1s steps(2) infinite;
    }
    @keyframes blink { 50% { opacity: 0; } }
    .hero .cta-row {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin-bottom: 2.5rem;
    }
    .btn {
      font-family: var(--mono);
      font-size: 0.78rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      padding: 0.85rem 1.4rem;
      border: 1px solid var(--rule);
      color: var(--text);
      border-radius: 2px;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
    }
    .btn:hover {
      border-color: var(--green);
      color: var(--green);
    }
    .btn.primary {
      background: var(--green);
      color: #000000;
      border-color: var(--green);
      font-weight: 700;
    }
    .btn.primary:hover {
      background: transparent;
      color: var(--green);
    }
    .hero .signals {
      display: flex;
      gap: 2rem;
      flex-wrap: wrap;
      font-family: var(--mono);
      font-size: 0.72rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .hero .signals b { color: var(--text); font-weight: 600; }
```

- [ ] **Step 3.2: Add hero markup**

Find the closing `</div>` of the topbar (the line immediately after the `</nav>`). Insert this block **after** the topbar's closing `</div>`:

```html
    <header class="hero page">
      <div class="kicker">v1.0.3 · Obsidian plugin · MIT</div>
      <h1>CURTIS<span class="accent">·</span>AI</h1>
      <p class="tag">Polyglot AI chat for Obsidian. Thirty-plus providers, one sidebar. Your vault stays yours.<span class="cursor"></span></p>
      <div class="cta-row">
        <a class="btn primary" href="https://github.com/JordanNewell/curtis-ai-chat/releases">⬇ Install</a>
        <a class="btn" href="https://github.com/JordanNewell/curtis-ai-chat">View source ↗</a>
        <a class="btn" href="https://community.obsidian.md/plugins/curtis-ai-chat">Obsidian ↗</a>
      </div>
      <div class="signals">
        <span><b>30+</b> providers</span>
        <span><b>9</b> agent tools</span>
        <span><b>0</b> warnings</span>
        <span><b>BYO</b> keys</span>
      </div>
    </header>
```

- [ ] **Step 3.3: Verify**

Refresh the page.
Expected:
- Big Newell "CURTIS·AI" headline (green middle dot), scaled with viewport.
- Tagline below with blinking green cursor block at the end.
- Three CTAs in a row: green-filled `⬇ Install`, outlined `View source ↗`, outlined `Obsidian ↗`.
- Signal stats row at the bottom: `30+ providers · 9 agent tools · 0 warnings · BYO keys`.
- Hover state on each CTA: border turns green, primary inverts (green→black text on transparent).

- [ ] **Step 3.4: Commit**

```bash
cd E:/dev/projects/curtis-ai-chat
git add docs/index.html
git commit -m "feat(site): add hero with wordmark, tagline, CTAs, signals"
```

---

### Task 4: Features section

**Files:**
- Modify: `docs/index.html` — append section CSS + features block

- [ ] **Step 4.1: Add section + features CSS**

Insert this block immediately before `</style>`:

```css
    /* ---------- section blocks ---------- */
    section.block {
      padding: 4rem 0;
      border-bottom: 1px solid var(--rule);
    }
    .block-head {
      display: flex;
      align-items: baseline;
      gap: 1rem;
      margin-bottom: 2rem;
      flex-wrap: wrap;
    }
    .block-head .num {
      font-family: var(--mono);
      font-size: 0.72rem;
      letter-spacing: 0.22em;
      color: var(--green);
    }
    .block-head h2 {
      font-family: "Newell", system-ui;
      font-size: clamp(1.8rem, 3vw, 2.4rem);
      color: #ffffff;
      letter-spacing: -0.02em;
      line-height: 1;
    }
    .block-head .meta {
      margin-left: auto;
      font-family: var(--mono);
      font-size: 0.7rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--muted);
    }

    /* ---------- features grid ---------- */
    .features {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.85rem;
    }
    .feat {
      background: var(--bg-2);
      border: 1px solid var(--rule);
      padding: 1.1rem 1rem;
      transition: border-color 0.15s ease, background 0.15s ease;
      min-height: 140px;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .feat:hover {
      border-color: var(--green-line);
      background: rgba(63, 255, 70, 0.04);
    }
    .feat .sym {
      font-family: var(--mono);
      font-size: 0.95rem;
      color: var(--green);
    }
    .feat h3 {
      font-family: "Newell", system-ui;
      font-size: 1rem;
      color: #ffffff;
      letter-spacing: -0.01em;
      line-height: 1.15;
    }
    .feat p {
      font-size: 0.82rem;
      color: var(--dim);
      line-height: 1.45;
    }
    .feat .id {
      margin-top: auto;
      font-family: var(--mono);
      font-size: 0.62rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--muted);
    }

    @media (max-width: 900px) { .features { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 520px) { .features { grid-template-columns: 1fr; } }
```

- [ ] **Step 4.2: Add features markup**

Find the closing `</header>` of the hero (end of Task 3 markup). Insert this **after** it:

```html
    <section class="block page" id="features">
      <div class="block-head">
        <span class="num">01</span>
        <h2>Features</h2>
        <span class="meta">8 highlights · v1.0</span>
      </div>
      <div class="features">
        <div class="feat">
          <span class="sym">🤖</span>
          <h3>Curtis Agent</h3>
          <p>AI calls 9 tools to read, create, and edit your vault notes.</p>
          <span class="id">AGENT·01</span>
        </div>
        <div class="feat">
          <span class="sym">⚔</span>
          <h3>Multi-model arena</h3>
          <p>Stream one prompt to 2 models in parallel, side-by-side.</p>
          <span class="id">ARENA·02</span>
        </div>
        <div class="feat">
          <span class="sym">⌫</span>
          <h3>Inline diff rewrite</h3>
          <p>Cursor-style rewrite with accept/reject modal + assignable hotkey.</p>
          <span class="id">DIFF·03</span>
        </div>
        <div class="feat">
          <span class="sym">@</span>
          <h3>@-mention notes</h3>
          <p>Type <code style="font-family:var(--mono);color:var(--green);">@</code> in chat, fuzzy-search your vault, attach as context.</p>
          <span class="id">MENTION·04</span>
        </div>
        <div class="feat">
          <span class="sym">🎙</span>
          <h3>Voice I/O</h3>
          <p>Whisper speech-to-text in, browser TTS out.</p>
          <span class="id">VOICE·05</span>
        </div>
        <div class="feat">
          <span class="sym">⌕</span>
          <h3>Cross-chat search</h3>
          <p>Fuzzy-matched picker across all conversations + messages.</p>
          <span class="id">SEARCH·06</span>
        </div>
        <div class="feat">
          <span class="sym">⤓</span>
          <h3>Markdown export</h3>
          <p>Download any conversation as <code style="font-family:var(--mono);color:var(--green);">.md</code> via <code style="font-family:var(--mono);color:var(--green);">/export</code>.</p>
          <span class="id">EXPORT·07</span>
        </div>
        <div class="feat">
          <span class="sym">🧠</span>
          <h3>Editable memory</h3>
          <p>Edit or delete individual memory facts. No more append-only.</p>
          <span class="id">MEMORY·08</span>
        </div>
      </div>
    </section>
```

- [ ] **Step 4.3: Verify**

Refresh.
Expected:
- Section header `01 Features` with `8 highlights · v1.0` meta on the right.
- 4×2 grid of feature cards at desktop width, 2×2 at tablet, single column at mobile.
- Each card: mono symbol (green), Newell title, description, ID stamp at the bottom.
- Hover: card border lightens to green-tinted, background tints faintly green.

- [ ] **Step 4.4: Commit**

```bash
cd E:/dev/projects/curtis-ai-chat
git add docs/index.html
git commit -m "feat(site): add 8-feature grid section"
```

---

### Task 5: Providers marquee

**Files:**
- Modify: `docs/index.html` — append marquee CSS + providers block

- [ ] **Step 5.1: Add marquee CSS**

Insert immediately before `</style>`:

```css
    /* ---------- providers marquee ---------- */
    .marquee-wrap {
      border: 1px solid var(--rule);
      background: var(--bg-2);
      overflow: hidden;
      position: relative;
    }
    .marquee-wrap::before,
    .marquee-wrap::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      width: 80px;
      z-index: 2;
      pointer-events: none;
    }
    .marquee-wrap::before {
      left: 0;
      background: linear-gradient(90deg, var(--bg-2), transparent);
    }
    .marquee-wrap::after {
      right: 0;
      background: linear-gradient(270deg, var(--bg-2), transparent);
    }
    .marquee {
      display: flex;
      gap: 3rem;
      padding: 1.2rem 0;
      animation: scroll 40s linear infinite;
      white-space: nowrap;
      font-family: var(--mono);
      font-size: 0.9rem;
      letter-spacing: 0.06em;
      width: max-content;
    }
    @keyframes scroll {
      from { transform: translateX(0); }
      to   { transform: translateX(-50%); }
    }
    .marquee span { color: var(--dim); }
    .marquee span.hot { color: var(--green); }
    .marquee span::before {
      content: "▪ ";
      color: var(--muted);
      margin-right: 0.3rem;
    }
    .marquee span.hot::before { color: var(--green); }
    .provider-meta {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-top: 1rem;
      font-family: var(--mono);
      font-size: 0.78rem;
      color: var(--muted);
    }
    .provider-meta b {
      color: var(--green);
      display: block;
      font-size: 1.4rem;
      margin-bottom: 0.2rem;
      font-weight: 400;
      letter-spacing: -0.01em;
    }
    @media (max-width: 700px) { .provider-meta { grid-template-columns: 1fr; } }

    @media (prefers-reduced-motion: reduce) {
      .marquee { animation: none; }
    }
```

- [ ] **Step 5.2: Add providers markup**

Insert this **after** the closing `</section>` of the features block:

```html
    <section class="block page" id="providers">
      <div class="block-head">
        <span class="num">02</span>
        <h2>Providers</h2>
        <span class="meta">30+ · BYOK</span>
      </div>
      <div class="marquee-wrap">
        <div class="marquee">
          <span class="hot">Anthropic</span><span>OpenAI</span><span class="hot">Google Gemini</span><span>Ollama</span><span>OpenRouter</span><span class="hot">Mistral</span><span>DeepSeek</span><span>Groq</span><span>Together</span><span>Fireworks</span><span>Cohere</span><span class="hot">xAI</span><span>Perplexity</span><span>Cerebras</span><span>OpenAI-Compatible</span><span>LM Studio</span><span class="hot">Anthropic</span><span>OpenAI</span><span class="hot">Google Gemini</span><span>Ollama</span><span>OpenRouter</span><span class="hot">Mistral</span><span>DeepSeek</span><span>Groq</span><span>Together</span><span>Fireworks</span><span>Cohere</span><span class="hot">xAI</span><span>Perplexity</span><span>Cerebras</span><span>OpenAI-Compatible</span><span>LM Studio</span>
        </div>
      </div>
      <div class="provider-meta">
        <div><b>30+</b>providers, one sidebar</div>
        <div><b>BYOK</b>keys in OS keychain (Obsidian 1.13+)</div>
        <div><b>Local</b>Ollama · LM Studio · fully offline</div>
      </div>
    </section>
```

- [ ] **Step 5.3: Verify**

Refresh.
Expected:
- Section header `02 Providers`.
- Single horizontal strip of provider names scrolling left at ~40s loop.
- Edge fade masks on both sides.
- "Hot" providers (Anthropic, Gemini, Mistral, xAI) in green.
- Three-cell meta strip below: `30+ providers, one sidebar` / `BYOK keys in OS keychain` / `Local Ollama · LM Studio · fully offline`.
- Open DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce" → marquee stops. Revert.

- [ ] **Step 5.4: Commit**

```bash
cd E:/dev/projects/curtis-ai-chat
git add docs/index.html
git commit -m "feat(site): add providers marquee + BYOK/local meta"
```

---

### Task 6: Research tease block (the centerpiece)

**Files:**
- Modify: `docs/index.html` — append research-block CSS + markup

- [ ] **Step 6.1: Add research-block CSS**

Insert immediately before `</style>`:

```css
    /* ---------- research tease ---------- */
    .research {
      background: var(--bg-2);
      border: 1px dashed var(--green-line);
      padding: 3rem 2rem;
      position: relative;
      overflow: hidden;
    }
    .research::before {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at 50% 0%, rgba(63, 255, 70, 0.06), transparent 60%);
      pointer-events: none;
    }
    .research > * { position: relative; }
    .research .scan {
      font-family: var(--mono);
      font-size: 0.7rem;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--green);
      margin-bottom: 1rem;
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
    }
    .research .scan .pulse {
      width: 8px;
      height: 8px;
      background: var(--green);
      border-radius: 50%;
      animation: pulse 1.4s ease-in-out infinite;
      box-shadow: 0 0 12px var(--green);
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.3; transform: scale(0.7); }
    }
    .research h3 {
      font-family: "Newell", system-ui;
      font-size: clamp(1.8rem, 4vw, 2.8rem);
      color: #ffffff;
      letter-spacing: -0.02em;
      margin-bottom: 0.8rem;
      line-height: 1;
    }
    .research h3 .dim { color: var(--muted); }
    .research p {
      font-size: 1rem;
      color: var(--dim);
      max-width: 620px;
      margin-bottom: 1.5rem;
      line-height: 1.6;
    }
    .research .typing {
      font-family: var(--mono);
      font-size: 0.85rem;
      color: var(--green);
      margin-bottom: 1.5rem;
      min-height: 1.4em;
    }
    .research .typing .cursor {
      display: inline-block;
      width: 8px;
      height: 1em;
      background: var(--green);
      vertical-align: -2px;
      margin-left: 2px;
      animation: blink 1s steps(2) infinite;
    }
    .research .actions {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .research .actions .btn { border-color: var(--green-line); }
    .research .actions .btn:hover {
      border-color: var(--green);
      background: rgba(63, 255, 70, 0.06);
    }

    @media (prefers-reduced-motion: reduce) {
      .research .scan .pulse,
      .research .typing .cursor { animation: none; }
    }
```

- [ ] **Step 6.2: Add research-block markup**

Insert this **after** the closing `</section>` of the providers block:

```html
    <section class="block page" id="research">
      <div class="block-head">
        <span class="num">03</span>
        <h2>Coming next</h2>
        <span class="meta">R&amp;D · soon</span>
      </div>
      <div class="research">
        <div class="scan"><span class="pulse"></span> RESEARCH INITIALIZING</div>
        <h3>Curtis AI <span class="dim">·</span> Research</h3>
        <p>Curtis AI Chat is step one. The next thing is built for people who treat their vault like an operating system — research-grade tools for thinking, writing, and finding patterns across years of notes.</p>
        <div class="typing">▒ calibrating scope<span class="cursor"></span></div>
        <div class="actions">
          <a class="btn" href="https://github.com/JordanNewell/curtis-ai-chat">★ Watch the repo ↗</a>
          <a class="btn" href="https://github.com/sponsors/JordanNewell">Back the build ↗</a>
        </div>
      </div>
    </section>
```

- [ ] **Step 6.3: Verify**

Refresh.
Expected:
- Section header `03 Coming next` with `R&D · soon` meta.
- Big dashed-green-border block inside.
- Top-left of block: pulsing green dot + `RESEARCH INITIALIZING` (the pulse animation should be visible — dot grows/shrinks).
- Headline `Curtis AI · Research` (middle dot dimmed gray).
- Body paragraph in dim gray, max-width ~620px.
- Typing line `▒ calibrating scope█` with blinking green cursor.
- Two outlined CTAs: `★ Watch the repo ↗` (green-tint border), `Back the build ↗`.
- Subtle radial green glow from top-center of the block.
- prefers-reduced-motion: pulse and cursor stop.

- [ ] **Step 6.4: Commit**

```bash
cd E:/dev/projects/curtis-ai-chat
git add docs/index.html
git commit -m "feat(site): add Curtis AI Research tease block"
```

---

### Task 7: Quick start section

**Files:**
- Modify: `docs/index.html` — append steps CSS + markup

- [ ] **Step 7.1: Add steps CSS**

Insert immediately before `</style>`:

```css
    /* ---------- quick start ---------- */
    .steps {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
    }
    .step {
      background: var(--bg-2);
      border: 1px solid var(--rule);
      padding: 1.4rem;
    }
    .step .n {
      font-family: var(--mono);
      font-size: 0.7rem;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--green);
      margin-bottom: 0.6rem;
    }
    .step h4 {
      font-family: "Newell", system-ui;
      font-size: 1.1rem;
      color: #ffffff;
      margin-bottom: 0.5rem;
      letter-spacing: -0.01em;
      line-height: 1.15;
    }
    .step p {
      font-size: 0.85rem;
      color: var(--dim);
      line-height: 1.5;
    }
    .step code,
    .ollama-note code {
      font-family: var(--mono);
      background: #111111;
      padding: 0.1rem 0.35rem;
      color: var(--green);
      font-size: 0.78rem;
      border-radius: 2px;
    }
    .ollama-note {
      margin-top: 1.5rem;
      font-family: var(--mono);
      font-size: 0.78rem;
      color: var(--dim);
      line-height: 1.6;
    }
    .ollama-note a { color: var(--green); }

    @media (max-width: 800px) { .steps { grid-template-columns: 1fr; } }
```

- [ ] **Step 7.2: Add quick-start markup**

Insert this **after** the closing `</section>` of the research block:

```html
    <section class="block page" id="install">
      <div class="block-head">
        <span class="num">04</span>
        <h2>Quick start</h2>
        <span class="meta">60 seconds</span>
      </div>
      <div class="steps">
        <div class="step">
          <div class="n">STEP 01</div>
          <h4>Install</h4>
          <p>Drop <code>main.js</code>, <code>manifest.json</code>, <code>styles.css</code> from the latest release into <code>.obsidian/plugins/curtis-ai-chat/</code>. Enable under Settings → Community plugins.</p>
        </div>
        <div class="step">
          <div class="n">STEP 02</div>
          <h4>Configure</h4>
          <p>Open Settings → Curtis AI Chat → Providers. Enable one, paste a key. Keys live in your OS keychain (Obsidian 1.13+).</p>
        </div>
        <div class="step">
          <div class="n">STEP 03</div>
          <h4>Send</h4>
          <p>Click the robot in the ribbon (or <code>Ctrl+Shift+G</code>), pick a model, type, hit Enter. That's it.</p>
        </div>
      </div>
      <p class="ollama-note">Offline-first? Install <a href="https://ollama.com">Ollama</a>, run <code>ollama pull qwen2.5:7b-instruct</code>, enable the Ollama provider. Nothing leaves your machine.</p>
    </section>
```

- [ ] **Step 7.3: Verify**

Refresh.
Expected:
- Section header `04 Quick start` with `60 seconds` meta.
- Three side-by-side step cards at desktop (single column at ≤800px).
- Each card: `STEP 0N` kicker (green), Newell title, description with inline `<code>` rendered in green mono on dark.
- Below the grid: small mono Ollama note with a working `Ollama` link and the `ollama pull qwen2.5:7b-instruct` command in green code style.

- [ ] **Step 7.4: Commit**

```bash
cd E:/dev/projects/curtis-ai-chat
git add docs/index.html
git commit -m "feat(site): add 3-step quick start + Ollama note"
```

---

### Task 8: Footer + final responsive pass

**Files:**
- Modify: `docs/index.html` — append footer CSS + markup

- [ ] **Step 8.1: Add footer CSS**

Insert immediately before `</style>`:

```css
    /* ---------- footer ---------- */
    footer {
      padding: 3rem 0 2rem;
      font-family: var(--mono);
      font-size: 0.72rem;
      color: var(--muted);
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    footer .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }
    footer .links {
      display: flex;
      gap: 1.4rem;
      flex-wrap: wrap;
    }
    footer .links a {
      color: var(--dim);
      border: none;
    }
    footer .links a:hover { color: var(--green); }
    footer .copy b { color: var(--text); font-weight: 600; }
```

- [ ] **Step 8.2: Add footer markup**

Insert this **after** the closing `</section>` of the quick-start block, but **before** `</body>`:

```html
    <footer class="page">
      <div class="row">
        <div class="links">
          <a href="https://github.com/JordanNewell/curtis-ai-chat">GitHub</a>
          <a href="https://github.com/JordanNewell/curtis-ai-chat/releases">Releases</a>
          <a href="https://github.com/JordanNewell/curtis-ai-chat/discussions">Discussions</a>
          <a href="https://www.buymeacoffee.com/jordannewell">Buy me a coffee</a>
          <a href="https://github.com/sponsors/JordanNewell">Sponsor</a>
        </div>
        <div class="copy"><b>Curtis AI</b> · MIT · by Jordan Newell</div>
      </div>
    </footer>
```

- [ ] **Step 8.3: Full-page responsive pass**

Open `file:///E:/dev/projects/curtis-ai-chat/docs/index.html` and verify at each width:

| Width | Expected behavior |
|---|---|
| 1440px | All sections visible at full layout. Topbar nav shows. Features in 4-col. Steps in 3-col. |
| 1024px | Same as 1440. Layout slightly tighter. |
| 768px | Features drop to 2-col. Steps still 3-col (just barely). |
| 640px | Topbar nav disappears. |
| 520px | Features drop to 1-col. |
| 375px (iPhone) | Everything stacks. No horizontal scroll. All CTAs full-width-friendly (wrap). Marquee still scrolls, edge masks still work. |
| 320px | Same as 375 — no overflow. |

Verify all of these **at each width**:
- No horizontal scrollbar.
- Hero headline scales smoothly (clamp).
- All CTAs reachable.
- Footer links wrap to second row if needed.

- [ ] **Step 8.4: Reduced-motion pass**

DevTools → Rendering → "Emulate CSS media feature `prefers-reduced-motion`: reduce".
Expected:
- Hero cursor stops blinking.
- Marquee stops scrolling.
- Research pulse stops pulsing.
- Research typing cursor stops blinking.
- All content remains fully readable.

Revert the emulation.

- [ ] **Step 8.5: Link audit**

Click every link in the rendered page. Expected destinations:
- Topbar `Features/Providers/Research/Install` → scroll to in-page anchors.
- Topbar `GitHub ↗` → https://github.com/JordanNewell/curtis-ai-chat
- Hero `⬇ Install` → https://github.com/JordanNewell/curtis-ai-chat/releases
- Hero `View source ↗` → https://github.com/JordanNewell/curtis-ai-chat
- Hero `Obsidian ↗` → https://community.obsidian.md/plugins/curtis-ai-chat
- Research `★ Watch the repo ↗` → https://github.com/JordanNewell/curtis-ai-chat
- Research `Back the build ↗` → https://github.com/sponsors/JordanNewell
- Ollama link → https://ollama.com
- Footer GitHub/Releases/Discussions/BMAC/Sponsor → respective URLs.

All must resolve (200, no 404). Note: the Obsidian community URL is correct only if the plugin has been submitted to community plugins — if it 404s, leave the link (it'll resolve when listed). BMAC and Sponsors use the `jordannewell` slug per existing manifest.json.

- [ ] **Step 8.6: Commit**

```bash
cd E:/dev/projects/curtis-ai-chat
git add docs/index.html
git commit -m "feat(site): add footer + complete responsive/reduced-motion/link pass"
```

---

### Task 9: Final visual + a11y QA

**Files:** none modified — verification only.

- [ ] **Step 9.1: Side-by-side with mockup**

Open both:
- The full-page mockup from brainstorming: `file:///E:/dev/projects/curtis-ai-chat/.superpowers/brainstorm/434949-1785202806/content/console-fullpage.html`
- The real page: `file:///E:/dev/projects/curtis-ai-chat/docs/index.html`

Compare at desktop width. They should be visually equivalent. Differences to expect (acceptable):
- Real page has slightly tighter section spacing (mockup used standalone styling, real inherits `section.block`).
- Real page adds `<meta>` tags, favicons, `aria`-nothing (no aria labels needed for this few landmarks).

Differences that indicate bugs (must fix):
- Wrong green (anything other than `#3FFF46`).
- Newell font fails to load (Network tab shows 4xx/5xx on the woff2).
- Layout breaks (overflow, wrong grid columns).

- [ ] **Step 9.2: Lighthouse pass (optional but recommended)**

In DevTools → Lighthouse → run on desktop + mobile.
Expected scores (acceptance thresholds):
- Performance ≥ 95 (single file, no JS, font-display: swap → should be 100).
- Accessibility ≥ 95.
- Best Practices ≥ 95.
- SEO ≥ 95.

If any score is lower, inspect and fix the specific audit failures.

- [ ] **Step 9.3: HTML validator (optional)**

Paste `docs/index.html` content into https://validator.w3.org/nu/#textarea. Expected: 0 errors, 0 warnings.

If warnings appear for `aria` or `lang`, fix inline.

- [ ] **Step 9.4: No commit needed**

Task 9 is verification-only. If fixes were needed, they get their own commits with descriptive messages.

---

### Task 10: Deploy — GitHub Pages config

**Files:**
- Create: `.nojekyll` (defensive — disables Jekyll processing so `_layouts`-style paths aren't filtered; not strictly needed for our paths but standard practice for `/docs` Pages sites).

- [ ] **Step 10.1: Create `.nojekyll`**

```bash
cd E:/dev/projects/curtis-ai-chat
touch docs/.nojekyll
```

(File lives in `docs/.nojekyll` so Pages sees it in the served root.)

- [ ] **Step 10.2: Push the branch**

```bash
cd E:/dev/projects/curtis-ai-chat
git add docs/.nojekyll
git commit -m "chore(site): add .nojekyll for raw Pages serving"
git push origin master
```

⚠️ **Per CLAUDE.md: never push without explicit permission.** Confirm with Jordan before running `git push`.

- [ ] **Step 10.3: Configure GitHub Pages (manual, browser)**

This step is performed by Jordan in the GitHub UI — it cannot be automated from this plan.

1. Go to https://github.com/JordanNewell/curtis-ai-chat/settings/pages
2. Under "Source", select **"Deploy from a branch"**.
3. Branch: **`master`**, folder: **`/docs`**.
4. Save.

Pages build takes 1–3 minutes. The site will be live at https://jordannewell.github.io/curtis-ai-chat/.

- [ ] **Step 10.4: Verify the live URL**

After the build completes (check https://github.com/JordanNewell/curtis-ai-chat/actions for the pages-build-deployment action if it appears), open https://jordannewell.github.io/curtis-ai-chat/ in the browser.

Expected:
- Page loads with the same content as `file://`.
- Favicon (nS 32px) appears in the browser tab.
- All sections render.
- Newell font loads (Network tab: 200 on the newell-typeface woff2).
- No console errors.

- [ ] **Step 10.5: Update splash badge on jordannewell.com (optional follow-up)**

Per the memory `project_figma-claude-joining-v0-1-2026-07-26` (and the Splash.astro inspection during brainstorming), the Curtis AI badge on jordannewell.com splash is currently `display:none`:

```html
<a href="https://community.obsidian.md/plugins/curtis-ai-chat" ... class="cs-curtis" style="display:none">
```

Now that curtis-ai-chat has its own Pages site, consider (in a separate session):
1. Update the `href` to `https://jordannewell.github.io/curtis-ai-chat/`.
2. Remove `style="display:none"`.

This is **out of scope** for this plan (separate repo) — flagged here as a known follow-up so it doesn't get forgotten.

---

## Self-review notes

**Spec coverage check:**
- ✅ Hero with kicker, Newell wordmark, tagline, 3 CTAs, signal stats → Task 3
- ✅ Sticky topbar with brandmark + status + nav → Task 2
- ✅ Features grid (8 cards, 4/2/1 responsive) → Task 4
- ✅ Providers marquee + meta strip → Task 5
- ✅ Research tease block with dashed border, pulse, typing cursor, 2 CTAs → Task 6
- ✅ Quick start (3 steps + Ollama note) → Task 7
- ✅ Footer with links + MIT + by Jordan Newell, no email → Task 8
- ✅ All 8 features from README represented → Task 4 (cards 1–8)
- ✅ Brand palette `#000` / `#FFF` / `#3FFF46` → Task 1 CSS variables
- ✅ Newell font loaded with `font-display: swap` → Task 1
- ✅ og:image, twitter:image, og:url, canonical → Task 1
- ✅ nS favicon (32px local, 512 + apple-touch from newell-typeface) → Task 1
- ✅ prefers-reduced-motion respected → Tasks 1, 5, 6
- ✅ No JS, no SSG, no Actions workflow → architecture
- ✅ Single file `docs/index.html` → architecture
- ✅ Mobile-friendly responsive → Tasks 2, 4, 5, 7, 8 (each adds breakpoints)
- ✅ No AI-attribution trailer anywhere → no commit message uses Co-Authored-By
- ✅ GitHub Pages from `/docs` on `master` → Task 10

**Placeholder scan:** no TBD, no TODO, no "implement later", no "similar to Task N", no "add appropriate error handling". All steps show actual code or actual commands.

**Type consistency:** CSS class names referenced in HTML (`topbar`, `hero`, `kicker`, `accent`, `tag`, `cursor`, `cta-row`, `btn primary`, `signals`, `block`, `block-head`, `num`, `meta`, `features`, `feat`, `sym`, `id`, `marquee-wrap`, `marquee`, `hot`, `provider-meta`, `research`, `scan`, `pulse`, `dim`, `typing`, `actions`, `steps`, `step`, `n`, `ollama-note`, `row`, `links`, `copy`) all defined in CSS. No orphan classes, no missing definitions.

**Scope:** single implementation plan, single file output. No decomposition needed.
