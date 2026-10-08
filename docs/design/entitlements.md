# Entitlements design — Curtis Pro licensing

**Date:** 2026-10-08 · **Status:** Design (pre-implementation) · **Owner:** Jordan
**Depends on:** [mor-decision.md](./mor-decision.md) (Polar.sh chosen as MoR + license authority)
**Effort target:** ~1.5–2 weeks solo (see §8 build checklist)

---

## 1. Free vs Pro feature matrix

**Label to select at submission: "Optional payments"** — Obsidian's May 2026 policy labels define this as: users can optionally pay to unlock extra features; labels exist to set user expectations about what costs money, and payments are handled entirely outside Obsidian via "license keys, API keys, and login gates" ([The future of Obsidian plugins](https://obsidian.md/blog/future-of-plugins)). Core chat must stay free so the plugin's *primary* surface never requires payment — that's what keeps the label honest and the listing defensible.

### Free forever (the product)

| Feature | Status in code today |
|---|---|
| BYOK chat, all 30+ providers, local models (Ollama/LM Studio) | Shipped |
| **Arena — 2 models, head-to-head** | Shipped (`src/ui/modals/arena-model-picker-modal.ts` — `MIN_SELECTIONS = MAX_SELECTIONS = 2`) |
| Vault Q&A (RAG), long-term memory, @-mentions, images, diff-rewrite, slash commands, selection actions, import, MCP | Shipped |

### Curtis Pro — $39 one-time license

| Gate | Exists today? | Rationale (why defensible as "optional") |
|---|---|---|
| **Agent mode** (tools: read/create/modify vault notes, web tools, MCP loop) | **Yes — currently free** (`enableAgent`, `src/types.ts:269`; toggle `src/settings.ts:624`; agent branch `src/chat/view.ts:1661`) | Autonomous multi-step vault modification is a power feature; single-turn chat/summarization/writing — the primary use — is untouched. Still the *weakest* gate morally because it ships free today → requires the communication plan in §9 (flag F-1). |
| **Voice I/O** (Whisper STT + Web Speech TTS) | **Yes — currently free** (`src/chat/voice.ts`, `src/chat/tts-controller.ts`, mic button `src/chat/view.ts:208`) | An input/output *modality*, not the core interaction; typed chat remains fully free. STT additionally depends on OpenAI's paid Whisper API, which ties naturally to paid-service framing. |
| **Arena > 2 models + saved comparisons** | Partial — 2-model arena ships; >2 and saved rounds are new | The canonical 2-model comparison — the plugin's headline workflow and marketing hook — stays free forever. >2 is a batch/power variant; nothing currently shipped is removed. |
| **Prompt-library sync across vaults/devices** | **No — net-new feature** | Zero-removal gate: nobody loses anything; Pro buys new surface area. Safest possible gate. |

Defensibility summary: 2 of 4 gates are net-new capability, and the two existing-feature gates sit on power/modal features while every primary workflow (chat, compare-two-models, vault Q&A) remains free — consistent with the "Optional payments" label definition ([source](https://obsidian.md/blog/future-of-plugins)). If Obsidian review ever pushes back on agent mode specifically, the pre-agreed concession is to move agent mode back to free and lean on voice + arena>N + sync as the Pro set (decision recorded here so it's not re-litigated mid-launch).

## 2. License lifecycle

```
purchase → key issuance → activation (paste key) → cached entitlement → periodic revalidation
                (Polar)          (POST activate)      (keychain + settings)    (≤ every 7 days)
```

### Purchase & issuance
1. User hits **Buy Curtis Pro — $39** (link from the gate panel or jordannewell.com) → Polar hosted checkout. Polar is MoR: it charges tax-inclusive prices per region and remits VAT/sales tax ([Polar MoR pricing](https://polar.sh/resources/pricing)).
2. On payment, Polar auto-issues a license key via the **License keys** benefit: prefix `CURTIS-`, **`limit_activations: 3`**, customer deactivation enabled, rotation enabled ([docs](https://polar.sh/docs/features/benefits/license-keys)). Key is delivered in the receipt email and lives in the customer's Polar portal.

### Activation in plugin settings
- Settings → Curtis → **Curtis Pro** section: paste key → **Activate**.
- Flow (all via Obsidian `requestUrl`, same transport convention as the rest of the plugin — no bare `fetch`):
  1. `POST https://api.polar.sh/v1/customer-portal/license-keys/activate` with `{ key, organization_id, label: "<os>-<hostname-slug>" }` — public endpoint, no auth token ([docs](https://polar.sh/docs/features/benefits/license-keys)).
  2. On `200`: response contains `activation.id` and the license object (`status: "granted"`, `limit_activations: 3`, `expires_at`). Persist:
     - **Secrets** (license key, activation id) → OS keychain via the existing `src/core/secrets.ts` pattern under prefix `curtis-license-` (same rationale as API keys — never plaintext in `data.json`).
     - **Non-secret cache** in `CurtisSettings.license` (see §3): `{ status: 'active', lastValidatedAt, entitlementVersion }`.
  3. On activation-limit error (`409`/`400` with message): show "This key is active on 3 devices. Deactivate one at polar.sh → customer portal → your purchase" with a link. Do **not** build an in-plugin deactivation-others UI — the Polar portal already does it (documented customer capability: "Deactivate activations").
- **Deactivate this device** button in the same section: `POST …/license-keys/deactivate` with key + activation id (exact customer-portal path to be confirmed against the API reference at implementation — activate/validate paths above are verbatim from the docs; deactivation is exposed both in-portal and via API). Removes local secret, clears cache.

### Validation & offline grace (the load-bearing rules)
- **On activation:** online required (inherent — you can't activate without the network).
- **Revalidation:** at most every **7 days**, checked only at plugin load, **asynchronously after** the view renders: if `now − lastValidatedAt > 7d`, fire a background `POST …/validate` (key + org id + activation id). Success → bump `lastValidatedAt`. No spinner, no blocking, no launch-time network call unless the window has elapsed.
- **Fail open:** any network error, timeout, or non-200 → **keep Pro unlocked** and leave `lastValidatedAt` untouched. Only when `now − lastValidatedAt > 30 days` does the plugin enter a soft "revalidate" state: Pro features show a one-time inline notice ("Couldn't verify your license in 30 days — reconnect to revalidate"), with a **Revalidate now** button and a link to the portal. Chat and all free features are never affected, settings/data are never touched, and the state self-heals on the next successful validation.
- **Rationale:** plugin users are frequently offline (local-first audience, airplane users, mobile). A license check must never degrade the app. The 30-day fail-open window means a Polar outage, a long trip, or a lapsed payment only ever produces a notice — never a broken tool. This mirrors the industry pattern for indie desktop licensing (validate on activation, then periodic revalidation) without its punitive failure modes.

### Edge cases
| Case | Behavior |
|---|---|
| Refund (14-day window) | Jordan refunds in Polar dashboard; optionally deactivate the key manually (or later: `order_refunded` webhook → revoke). Grace window means a refunded user keeps Pro ≤30 days — accepted cost of fail-open. |
| Key rotated in portal | Old key fails validation → revalidation notices → user pastes new key (Activate flow again, same slot). |
| 4th device activation attempt | Polar rejects; error copy points to portal self-serve deactivation. |
| Multiple vaults, same machine | Activation is per-device; each vault's settings carry the non-secret cache, secrets shared via OS keychain → second vault validates without consuming a second activation slot (keychain lookup hit → background validate). |
| User never online after activation | Fine for 30 days, then soft notice. |

## 3. In-code architecture

New module `src/licensing/` (~4 files, target <400 LOC total). One seam, one direction of dependency: features import from `licensing`, never the reverse.

```
src/licensing/
  types.ts        // LicenseState, EntitlementCache, Polar API response types
  store.ts        // read/write license secret (keychain via core/secrets.ts) + settings cache
  client.ts       // LicenseClient interface + PolarLicenseClient (requestUrl calls to activate/validate/deactivate)
  entitlements.ts // THE SEAM: isProUnlocked(), ProFeature type, gate() helper, event emit
  index.ts        // re-exports
```

```ts
// types.ts
export type ProFeature = 'agent' | 'voice' | 'arenaMulti' | 'promptSync';

export interface LicenseState {
  status: 'none' | 'active' | 'graceExpired';   // derived, never persisted as truth
  lastValidatedAt: number | null;               // epoch ms
  activationId: string | null;                  // mirrored from keychain for display
}

// entitlements.ts — the only API the rest of the plugin sees
export function isProUnlocked(): boolean;                    // single seam
export function isFeatureUnlocked(f: ProFeature): boolean;   // all features share the flag in v1
export function gateHit(f: ProFeature): void;                // logs locally + returns panel data for UI
```

- `isProUnlocked()` is a **pure, synchronous** read of an in-memory `LicenseState` initialized at `onload()` from keychain + settings cache. No async, no network in the hot path — call sites stay trivial.
- Validation scheduler lives in `store.ts`, invoked from `main.ts` `onload()` after settings load: `maybeRevalidate()` → if `>7d`, background `client.validate()` → update state + persist. All failures swallowed (fail-open per §2).

### Exact gate call sites (verified in code)
| Feature | File | Change |
|---|---|---|
| Agent mode | `src/settings.ts:624` (`enableAgent` toggle) + `src/chat/view.ts:1661` (agent branch) | Toggle shows a lock note when `!isProUnlocked()`; view falls back to plain chat with one-time inline panel |
| Voice I/O | `src/chat/view.ts:208` (mic button) + TTS entry in `message-renderer.ts` | Buttons render; tapping opens gate panel (don't hide affordances — discovery is the upsell) |
| Arena >2 | `src/ui/modals/arena-model-picker-modal.ts` (`MAX_SELECTIONS = 2`) | Free: stays 2, picker shows "Pro: compare up to 4" hint on 3rd toggle; Pro: raise to 4 (v1 cap, server-side key still authoritative) |
| Prompt-library sync | New feature — build directly behind `isFeatureUnlocked('promptSync')` | Ship after launch; gate exists from day one in the seam |

### The honest limitation: this gate is soft, and that's fine
The repo is MIT and Obsidian **currently does not accept new closed-source plugins** ([May 2026 blog](https://obsidian.md/blog/future-of-plugins)) — so the gate ships in public source and anyone can `grep isProUnlocked`. Options considered:

| Option | Verdict | Why |
|---|---|---|
| **Keep gate simple, rely on goodwill** ✅ | **Chosen** | The audience is BYOK enthusiasts who already get 30+ providers free; the license is cheap ($39) and the author is reachable. Piracy- resistance beyond "not trivially convenient" is wasted effort at 50 sales/mo. A soft gate also minimizes the cost of bugs (a broken gate can't brick chat). |
| Private build-time Pro module | Rejected | Conflicts with Obsidian's no-new-closed-source stance for directory listings; doubles release engineering (two artifacts, secret management for esbuild injection) for near-zero protection — the free build still contains every call site. |
| Minification/obfuscation of the gate | Rejected | Likely violates Developer Policies (obfuscation has long been disqualifying — **re-verify exact wording at [docs.obsidian.md/Developer+policies](https://docs.obsidian.md/Developer+policies)**), and reads as hostile to an OSS community. |
| Server-side feature delivery (features live behind an API) | Rejected | Violates local-first ethos; breaks offline; ongoing server cost/uptime burden for a solo dev — exactly what Phase 2 is trying to avoid. |

Mitigations that ship anyway: make honest use *easier* than circumvention (paste-one-key vs edit-source), never phone home beyond validation, and state plainly on the purchase page that it's a trust-based license for one human's work.

## 4. Upsell UX

Rules: **in-context only, once per session per feature, zero launch modals, zero nagging, zero badges on free features.**

- A gate hit renders an inline panel in the chat view (or replaces the toggled row in settings), containing: feature name, one line of value, price, two actions:

  > **Compare up to 4 models side by side**
  > Curtis Pro adds multi-model arenas and saved comparisons — $39 once, yours forever.
  > [Unlock Curtis Pro] [I have a license key…]

- The "I have a license key" affordance expands an inline paste field (activation without leaving the panel).
- Copy tone: matter-of-fact, no guilt, no "support the developer" leverage, no urgency timers. The plugin's voice elsewhere (settings descriptions) is dry and useful — Pro copy matches it.
- Settings keeps a permanent, quiet **Curtis Pro** section (status when active; purchase + key paste when not) so nobody has to trigger a gate to find licensing.

## 5. Metrics

**Default: no telemetry, full stop.** The plugin is local-first and the Developer Policies restrict undisclosed data capture ([Obsidian privacy stance](https://obsidian.md/privacy); policies at [docs.obsidian.md/Developer+policies](https://docs.obsidian.md/Developer+policies) — re-verify wording at implementation). Revenue signal already exists without instrumenting users: Polar's sales dashboard is the conversion truth, and weekly download counts are tracked by the Phase 0 GitHub Action.

What ships instead — **local-only counters**, never transmitted:

| Counter | Where | Use |
|---|---|---|
| `gateHits: Record<ProFeature, number>` | `CurtisSettings` (per-vault) | Jordan-visible via a dev command ("Curtis: Show local stats"); tells *you* nothing about users, but a curious user can see it too — honest by construction |
| `licenseState` + `lastValidatedAt` | settings cache | Support debugging ("what does the plugin think?") |

If aggregate funnel data is ever genuinely needed later, the only acceptable shape is an **explicit opt-in** anonymized ping (one boolean in settings, off by default, disclosed on the privacy page, payload = feature-id + event-type only, no content, no identifiers). Recommendation: don't build it until a concrete decision needs it; sales count + download count answer the Phase 2 go/no-go.

## 6. Pricing

- **$39 one-time.** Anchor: TypingMind proved $39 one-time + BYOK at scale ($22K week one, $1M in ~20 months — [buy page](https://www.typingmind.com/buy), [LS case study](https://www.lemonsqueezy.com/case-study/typing-mind), [$500K reflection](https://news.tonydinh.com/p/500k-milestone-my-reflections-after)). One-time also matches the audience's subscription fatigue, keeps the promise simple ("yours forever"), and requires zero recurring-billing infrastructure. Net after Polar Starter fees: **$36.55/sale** ([fees](https://polar.sh/resources/pricing)).
- **Launch discount: $29 for the first 2 weeks** (or first 100 buyers, whichever first — fixed quantity reads better in an announcement post). Configured as a Polar discount, no code paths involved.
- **Upgrade policy (state it on the purchase page):** the license covers **all future updates of Curtis Pro for the Obsidian plugin**, forever. The Phase 3 standalone desktop app is a separate product with its own price; Pro customers get a launch discount on it (target: $20 off). Do not promise "all future Curtis AI products" — that's an unbounded liability.
- **Future options (not now):** bundle (plugin + app) around $59 at app launch; volume/team licenses only if someone asks ≥3 times.

## 7. Compliance checklist (re-verify each at implementation)

- [ ] **Developer Policies** — read current text at [docs.obsidian.md/Developer+policies](https://docs.obsidian.md/Developer+policies): no undisclosed data collection; no remote code execution; no obfuscation (confirm exact wording, cited in §3); no misleading listings. Last verified via search Oct 2026.
- [ ] **"Optional payments" label** — select during community-site submission/update ([May 2026 blog](https://obsidian.md/blog/future-of-plugins)); ensure the plugin listing copy states what's free and what's Pro *before* install.
- [ ] **Manifest & listing copy** — `manifest.json` description currently ends "Free, MIT" (accurate for the core; update at launch to e.g. "Free core, MIT. Optional Pro license for agent mode, voice, arena>2, sync."). Keep the arena/"compare models" lead.
- [ ] **README & docs** — add a "Free vs Pro" section; **supersede `docs/MONETIZATION.md`** (it currently states "No feature of this plugin will ever be paywalled" and "never gate a plugin feature" — stale after this decision; replace its content with a pointer to these two design docs in the same PR as the gate, not silently).
- [ ] **Refund policy: 14 days, no questions** — stated on the purchase page; executed by Jordan via Polar dashboard; add to ToS.
- [ ] **ToS page on jordannewell.com** — license grant (one-time, 3 devices, lifetime plugin updates, refund window), acceptable use, liability cap. One static page.
- [ ] **Privacy page on jordannewell.com** — state exactly what license validation transmits (license key, activation id, organization id to api.polar.sh), that **no chat content, vault content, or usage data ever leaves the machine**, and that there is no telemetry. Link from plugin settings Pro section.
- [ ] **Payment labelling on checkout** — Polar handles tax-inclusive display; verify EU/UK VAT-inclusive price display looks sane for $39.
- [ ] **Closed-source constraint** — everything ships in the MIT repo ([no new closed-source plugins](https://obsidian.md/blog/future-of-plugins)); §3 option table already encodes this.

## 8. Build checklist (ordered, solo, ≈8.5 working days)

| # | Task | Est. | Notes |
|---|---|---|---|
| 1 | Polar account, product, license benefit (`CURTIS-`, limit 3), $39 price + $29 launch discount, copy `organization_id` | 0.5d | Per [mor-decision.md](./mor-decision.md) signup checklist |
| 2 | `src/licensing/` module: types, store (keychain via `src/core/secrets.ts`), `PolarLicenseClient` on `requestUrl` | 1d | Client behind `LicenseClient` interface (MoR swap = 1 file) |
| 3 | `isProUnlocked()` seam + onload init + 7-day revalidation scheduler with fail-open | 1d | Pure-sync seam; all failures swallowed |
| 4 | Activation UI in settings (paste key, status, deactivate device) | 1d | Error copy for limit/invalid/rotated states |
| 5 | Wire gates: agent toggle + view branch, mic/TTS, arena `MAX_SELECTIONS` conditional (2→4) | 1d | Gates render affordances; taps open panels |
| 6 | Inline gate panels + copy + once-per-session dedupe | 0.5d | §4 strings verbatim |
| 7 | Purchase page + ToS + privacy pages on jordannewell.com | 1d | §7 copy source |
| 8 | README/manifest/docs updates + supersede `docs/MONETIZATION.md` | 0.5d | Same-PR rule from §7 |
| 9 | Test matrix: airplane mode, 30-day grace expiry (fake clock), 3-device limit, rotation, second vault, mobile smoke (`isDesktopOnly: false` — requestUrl path) | 1d | Grace logic is the only subtle code; test it hard |
| 10 | Announcement draft + Pro section in forum/README; ship with milestone release | 0.5d | Week 8 beat per go-forward plan |
| | **Total** | **8.5d** | Fits the 1.5–2 week envelope with buffer |

## 9. Flags & open questions

- **F-1 (trust):** agent mode and voice I/O ship free today — gating them is a removal for existing users. Mitigations: announcement explains the free-core promise (chat, 2-model arena, vault Q&A stay free) + why Pro exists; changelog posts the full matrix; consider a 30-day "agent mode stays free for existing settings users" grace where the toggle remains on if it was already on. Decide before release; default = no grandfathering (complexity) + honest announcement.
- **F-2 (policy drift):** re-verify Developer Policies + label definitions at implementation (§7) — the May 2026 platform relaunch is new and rules may still be settling.
- **OQ-1:** confirm exact Polar customer-portal **deactivate** path + webhook event names at signup (activate/validate are verbatim from current docs).
- **OQ-2:** arena Pro cap — 4 models (v1 suggestion) vs unlimited; saved-comparisons storage shape (new doc before building that feature).
