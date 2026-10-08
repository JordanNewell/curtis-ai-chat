# Merchant-of-record decision — Curtis Pro

**Date:** 2026-10-08 · **Status:** Decided (pending Jordan's account signup) · **Owner:** Jordan
**Scope:** Where Curtis Pro ($39 one-time license) is sold, and where license keys live.

---

## Decide

**Use [Polar.sh](https://polar.sh) (Starter plan, free) as merchant of record and license-key authority for Curtis Pro.**

Single strongest reason: **Polar is the only healthy, actively-developed MoR that ships a built-in license-key system with everything the plugin needs — issuance on purchase, an `activate` endpoint with activation limits, a `validate` endpoint, customer-portal self-serve deactivation, and key rotation — meaning zero backend for a solo dev, with keys and validation matching the offline-grace design in [entitlements.md](./entitlements.md) one-to-one.** Lemon Squeezy has the same API shape but is being absorbed into Stripe Managed Payments ([its own Jan 2026 update](https://www.lemonsqueezy.com/blog/2026-update) confirms the team now builds Stripe's MoR and cites "slower support responses and less frequent product updates"), so starting on LS in Oct 2026 buys a migration inside the product's first year.

**Runner-up: Lemon Squeezy** — identical 5% + $0.50 economics and a proven license API (it ran TypingMind's $1M run); acceptable only if Polar's merchant verification stalls, and only with eyes open about its sunset trajectory. Do **not** start on Stripe Managed Payments yet (higher all-in cost, no built-in license keys, still ramping from public preview) — revisit if Polar ever folds, since LS→SMP migration paths would carry existing stores over.

---

## Context

- Solo dev, no sales-tax registration anywhere, selling globally → merchant of record (MoR) required: the MoR is the legal seller, handles global VAT/sales tax, invoicing, fraud, and refunds ([MoR explainer](https://stripe.com/resources/more)).
- The plugin needs **license keys** (not accounts): Obsidian's May 2026 community-platform announcement explicitly names "license keys, API keys, and login gates" as the external payment mechanisms developers handle themselves — Obsidian takes no cut ([The future of Obsidian plugins](https://obsidian.md/blog/future-of-plugins)).
- Volume reality: Phase 2 target is ~50 sales/month (~$2K). At that volume fee differences between platforms are ~$40/mo — **the deciding axes are platform trajectory, license-key ergonomics, and solo-dev onboarding**, not fees.

## Decision table (Oct 2026)

| | **Polar.sh** ✅ | Lemon Squeezy ⚠️ (runner-up) | Stripe Managed Payments | Paddle | FastSpring |
|---|---|---|---|---|---|
| **Status Oct 2026** | Active, developer-OSS focused; transparent public pricing | Owned by Stripe; team building Stripe's MoR; quiet roadmap, support degrading ([2026 update](https://www.lemonsqueezy.com/blog/2026-update)) | Public preview Feb 2026; waitlist → GA ramp ([LS 2026 update](https://www.lemonsqueezy.com/blog/2026-update)) | Active, mature; heavier merchant approval | Active, enterprise-leaning; quote-based pricing |
| **MoR / global tax** | Yes — resells product, handles VAT/sales tax ([pricing](https://polar.sh/resources/pricing)) | Yes | Yes | Yes | Yes |
| **Fee at $39 one-time** | **5% + $0.50 = $2.45 → net $36.55** (Starter, free plan); Pro $20/mo drops to 3.8% + $0.40 ([plans](https://polar.sh/blog/introducing-polar-plans), [fees](https://polar.sh/docs/merchant-of-record/fees)); +1.5% intl cards | 5% + $0.50 = $2.45 → net $36.55 ([fee comparison](https://www.creem.io)) | ~3.5% MoR fee **stacked on** Stripe processing → ~6.4% + $0.30 ≈ $2.80 ([creem.io analysis](https://www.creem.io)) | ~5% + $0.50 = $2.45 ([creem.io](https://www.creem.io)) | ~5.9% + $0.95 ≈ $3.25, or ~8.9% flat; quote-based ([public comparisons](https://www.capterra.co.uk)); $100 payout minimum |
| **License key issuance on purchase** | ✅ Built-in "License keys" benefit; auto-issued, branded prefix (e.g. `CURTIS-…`), shown in customer portal ([docs](https://polar.sh/docs/features/benefits/license-keys)) | ✅ Built-in; keys on product/order ([docs](https://docs.lemonsqueezy.com/help/license-keys)) | ❌ Not part of MP → build issuance via webhooks + own storage or third party ([LicenseSeat](https://licenseseat.com), [Keyforge](https://keyforge.dev)) | ❌ Not built-in (Billing) → third party | Partial (custom) |
| **Activation + limits** | ✅ `POST /v1/customer-portal/license-keys/activate` (key, org id, label, conditions) → activation instance; `limit_activations` (e.g. 3) enforced server-side ([docs](https://polar.sh/docs/features/benefits/license-keys)) | ✅ `POST /v1/licenses/activate` with `instance_name`; `activation_limit`/`activation_usage` on key object ([API](https://docs.lemonsqueezy.com/api/license-api/activate-license-key)) | ❌ DIY | ❌ DIY | Partial |
| **Validation endpoint** | ✅ `POST /v1/customer-portal/license-keys/validate` (key + org id + activation id); public, no auth, callable from plugin via `requestUrl` ([docs](https://polar.sh/docs/features/benefits/license-keys)) | ✅ `POST /v1/licenses/validate` ([API](https://docs.lemonsqueezy.com/api/license-api/validate-license-key)) | ❌ DIY | ❌ DIY | Partial |
| **Deactivation** | ✅ Customer self-serves in Polar portal ("Deactivate activations" is a customer-portal feature) — no support burden ([docs](https://polar.sh/docs/features/benefits/license-keys)); key rotation also built in | ✅ `POST /v1/licenses/deactivate` ([API](https://docs.lemonsqueezy.com/api/license-api/deactivate-license-key)) | ❌ DIY | ❌ DIY | Partial |
| **Webhooks** | ✅ Order/subscription/license events for refund→revoke automation | ✅ `order_created`, `order_refunded`, license events | ✅ Stripe-grade webhooks | ✅ | ✅ |
| **Solo-dev ergonomics** | Self-serve signup, no sales call, public pricing, checkout hosted; review = account review with 0.4% chargeback cap ([pricing page](https://polar.sh/resources/pricing)) | Self-serve (legacy flow still open per 2026 update) | Waitlist/GA ramp; requires Stripe account | Merchant approval process; slower start | Sales-led onboarding |
| **Trajectory risk** | Low-moderate (VC-funded, focused) | **High** — sunset-by-absorption | Low (Stripe) but feature gap today | Low | Low-moderate |

### Fee math sanity check at Phase-2 volume (50 sales/mo)

| Platform | Net/sale | Monthly net (50 × $39) |
|---|---|---|
| **Polar Starter** | $36.55 | $1,827 |
| Lemon Squeezy | $36.55 | $1,827 |
| Stripe Managed Payments | ~$36.20 | ~$1,810 |
| Paddle | ~$36.55 | ~$1,827 |
| FastSpring | ~$35.75 | ~$1,787 |

Spread: ~$40/mo. Confirms fees are not the decision axis. Upgrade path inside Polar: Pro ($20/mo, 3.8% + $0.40) breaks even vs Starter at ≈ **112 sales/month** ((5%+50¢) − (3.8%+40¢) = 18¢/sale); switch then, not before.

## Precedents — how indie/Obsidian/VS Code plugins sell today

| Product | Model | License mechanics | Source |
|---|---|---|---|
| **TypingMind** (closest analog: BYOK chat frontend) | $39 one-time (later $79); $22K week one, **$1M in ~20 months** | License key sold via Lemon Squeezy | [typingmind.com/buy](https://www.typingmind.com/buy), [LS case study](https://www.lemonsqueezy.com/case-study/typing-mind), [Tony Dinh $500K reflection](https://news.tonydinh.com/p/500k-milestone-my-reflections-after) |
| **Smart Connections** (Obsidian, #1-adjacent AI plugin) | Free plugin + paid Pro (hosted features) | Account/license delivered post-purchase; "welcome email with license key" support threads exist | [GitHub issue, Smart Connections Pro license](https://github.com/brianpetro/obsidian-smart-connections) |
| **VS Code indie extensions** | Marketplace blocks paid extensions from individuals → free listing + external license | MoR (LS/Polar/Gumroad/Dodo) + in-extension validation is the standard playbook | [Dodo: How to sell VS Code extensions](https://dodopayments.com/blogs/sell-vscode-extensions), [Microsoft on paid extensions](https://devblogs.microsoft.com/bharry/paid-extension-in-the-visual-studio-marketplace) |
| **GitLens Pro** (VS Code, large-scale) | Free core + Pro via vendor account (GitKraken) | Account-gated, not key-gated — needs backend; not viable for solo | [gitkraken.com](https://www.gitkraken.com/gitlens) |
| **Indie Mac/desktop apps** | Dedicated licensing platforms (Keygen, Cryptolens) | Chosen when you need HWID locking/offline cryptographically-signed keys; overkill for a trust-based soft gate; indie comparison found MoR built-ins "good enough" at small scale | [Indie licensing-tools comparison: Keygen, Cryptolens, LS, Polar, Gumroad](https://dev.to/nicodemanez/i-compared-the-licensing-tools-for-my-indie-mac-app-the-honest-breakdown-40a5) |

Takeaway: the market-standard for a solo Obsidian/VS Code plugin is exactly this plan — free listing + MoR checkout + platform-issued license key validated in-app. Keygen/Cryptolens-class platforms solve a threat model (determined pirates) that an MIT open-source plugin doesn't have (see [entitlements.md §3](./entitlements.md) for the soft-gate analysis).

## Consequences & follow-ups

1. **Signup checklist (Jordan, ~1h):** create Polar account → pass account review → create product "Curtis Pro" ($39, one-time) → add "License keys" benefit: prefix `CURTIS-`, **activation limit 3**, enable customer deactivation + rotation → copy `organization_id` + checkout URL into the entitlements config ([license benefit docs](https://polar.sh/docs/features/benefits/license-keys)).
2. **Confirm at signup (not blockers):** payout schedule/rails for Jordan's country and Polar's current webhook event names for `order_refunded` → manual refund handling is fine at launch (webhook automation is a later nicety).
3. **Fallback trigger:** if Polar account review takes >1 week or rejects, open LS instead — plugin code targets a thin `LicenseClient` interface ([entitlements.md §3](./entitlements.md)), so swapping MoR is ~1 file.
4. **Re-verify before implementation:** Polar plan pricing (post-May-2026 restructure is new) and the LS/SMP migration timeline ([2026 update](https://www.lemonsqueezy.com/blog/2026-update)) at launch.

**Related:** [entitlements.md](./entitlements.md) — the implementation design that consumes this decision.
