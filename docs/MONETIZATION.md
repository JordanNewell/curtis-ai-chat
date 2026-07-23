# Monetization strategy

> **TL;DR — The plugin stays free forever. Every feature works with your own API keys. Revenue comes from sponsorship now, and from adjacent paid products (Curtis Cloud, separate apps in the Curtis AI line) once adoption justifies them. No feature of this plugin will ever be paywalled.**

This doc is the maintainer's strategy for how curtis-ai-chat fits into a broader Curtis AI product line. It's public because the strategy is honest and the README already commits to it implicitly.

---

## Context

curtis-ai-chat is **the first product in a planned Curtis AI line**. That framing drives every monetization decision below.

Three facts shape the strategy:

1. **Public commitment.** The README says: *"Curtis AI Chat is and will remain free and open source under the MIT license. Every feature works with your own API keys. Sponsorship is voluntary and appreciated, never required."* That's a contract with early users — reversing it would burn trust we need for product #2.
2. **BYOK architecture.** The plugin never pays AI cost. Users pay their provider directly. There is no metered-cost pressure that forces a paid tier.
3. **Market reality.** The Obsidian AI-plugin category is free+sponsor across the board — Smart Connections, Copilot for Obsidian, Text Generator. Charging for plugin features alone, on product #1 of N, is the wrong fight.

---

## The strategy: top-of-funnel

The plugin's job is **maximum adoption**, not maximum ARPU. Adoption becomes the audience for product #2, #3, and beyond. Every dollar we'd extract by gating plugin features costs 5–10× in audience size for the next launch.

Direct monetization (sponsorship, Buy Me a Coffee) is a **side-effect** of adoption — not the goal.

---

## What charges, what doesn't

| Surface | Charges? | Notes |
|---|---|---|
| Plugin core (chat, providers, memory, agent, arena, voice, images, slash commands, diff rewrite, @-mentions, selection actions) | **Never** | Public commitment. MIT. BYOK. |
| Future plugin features | **Never** | Same commitment applies forward. |
| Sponsorship / Buy Me a Coffee | Voluntary | Already wired. Covers time + server costs. |
| **Curtis Cloud** (hosted API proxy, cross-device sync) | Yes — when shipped | Separate product. Plugin stays BYOK; cloud is opt-in. |
| **Other Curtis AI products** (desktop app, CLI, browser extension) | Yes — when shipped | Different surface, same audience. |
| Content / courses | Maybe | Lowest lift. Fits OSS maintainer persona. |

---

## Timeline and signals

The triggers below are **adoption signals**, not calendar dates. We move when the signal fires, not when the quarter ends.

| Signal | Move |
|---|---|
| Now → v1.0 lands in community plugin directory | Free, sponsor-only. Optimize README, settings funnel, Discord. Track installs + stars + DAU. |
| ~500 GitHub stars / ~2K DAU | Stand up Discord + mailing-list capture. Audience becomes the asset. Start scoping product #2. |
| ~2K stars / clear retention (30-day retention > 20%) | Commit to product #2. **This** is when paid revenue starts — for the new thing, not the plugin. |
| Product #2 launch | Free tier of new product hooks into curtis-ai-chat (plugin recommends it). Plugin is now top-of-funnel for paid product. |

Until the ~500-star signal fires, **do not spend time on paid-tier infrastructure**. No license servers, no feature flags, no Stripe integration. That work is premature and distracts from the actual job (adoption).

---

## Adjacent product candidates (for when the signal fires)

Ordered by likely shipping order, not priority.

### 1. Curtis Cloud

Hosted companion service. Plugin stays BYOK; the cloud tier is opt-in.

- **API proxy** — one Curtis Cloud API key instead of juggling 30 provider keys. One bill, one place to rotate.
- **Cross-device sync** — memory file + conversation history across desktop, mobile, multiple vaults. Obsidian Sync doesn't cover plugin data.
- **Hosted memory** — embeddings + semantic recall without local sqlite-vec setup.

Direct model: Smart Connections (free plugin + paid hosted sync). Real pain point being solved, not a manufactured paywall.

### 2. Separate Curtis AI app

Different surface, same audience. Candidates:

- **Desktop app** (Tauri/Electron) — same chat UX, no Obsidian dependency. Reaches non-Obsidian users.
- **CLI** — `curtis` chat in the terminal. Devs who don't want a GUI.
- **Browser extension** — chat with the page you're on.

The plugin built the audience; the app monetizes a wider one.

### 3. Content / course

Lowest lift. Could ship anytime, doesn't need adoption threshold.

- Build-log / devlog of Curtis AI line
- Prompt-engineering for note-taking workflows
- "How I built a 30-provider Obsidian plugin" technical writeup

Fits the OSS maintainer persona. Probably launches alongside product #2, not before.

---

## Operating principles

Rules of thumb for day-to-day decisions.

1. **Never gate a plugin feature.** Includes future ones. The README promise applies forward, not just to v1.0.
2. **Optimize for adoption, not ARPU.** When in doubt, pick the option that grows installs/stars/DAU.
3. **Sponsorship is the only direct revenue from the plugin.** Don't apologize for the ask, don't push it.
4. **Measure the funnel.** Stars, installs (when exposed via Obsidian stats), DAU, Discord joins, mailing-list signups. Without these numbers, we can't know when to ship product #2.
5. **Build no paid infrastructure prematurely.** No Stripe, no license server, no feature flags — until the ~500-star signal fires.
6. **The Curtis AI line compounds.** Every product should reference the others. The plugin is product #1 specifically because free OSS is the lowest-friction way to build the audience product #2 needs.

---

## What this strategy is not

- **Not "we'll never make money on this."** Sponsorship is real income once adoption scales. Adjacent products are real income once the audience exists.
- **Not "OSS purity above all."** The strategy is pragmatic — free plugin because that's what the market rewards in this category, not because paid software is bad.
- **Not set in stone.** Revisit at the ~500-star signal. If adoption plateaus below threshold for 6+ months, reassess. If a clear willingness-to-pay signal appears (e.g. heavy enterprise interest), reassess.
