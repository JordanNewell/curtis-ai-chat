# Contribution Pipeline — Go/No-Go Package

> Task fleet-cabinet #717 / BIG LOOP #712. Owner: Lucy. **Decision required: Jordan.**
> Guardrail honored: no repo flips to external PRs by this plan. This is the package to approve or reject.

## 0. What already exists (better than assumed)

Scoping found the pipeline is ~70% built: CONTRIBUTING.md (249 lines, includes audit checklist), PR template with typed-change checklist, zero-warning ESLint CI on every PR, CODE_OF_CONDUCT, SECURITY.md, issue templates, gitleaks pre-commit + a commit-subject OPSEC hook. The gaps: no CODEOWNERS, no architecture guidelines doc, no DCO/CLA decision, no triage SLA, no branch-protection/merge policy for external contributors, and no staged rollout plan for which contribution classes open first.

## 1. Additions needed before gates open (the actual work)

| Item | What | Est. |
|---|---|---|
| CODEOWNERS | `/src/providers/ @JordanNewell`, `/src/core/ @JordanNewell`, docs + themes open | 0.25d |
| ARCHITECTURE.md | Module map + invariants (from CONTRIBUTING structure section, expanded): provider interface contract, "no new renderer" rule, transport policy, secrets rule (never log/emit keychain values) | 1d (Cameron) |
| CONTRIBUTING amendments | DCO sign-off (`Signed-off-by`) instead of CLA — lightweight, no legal entity to maintain | 0.25d |
| CI additions | `npm run build` gate + bundle-size budget assertion (plugin must stay lean); typecheck job already implicit in lint | 0.5d (Darlene) |
| Triage playbook | Label taxonomy (`area:`, `good-first-issue`, `needs-repro`), 7-day first-response SLA, who triages (owner by default; delegate to Angela when volume justifies) | 0.5d |
| Branch protection | master: required lint + build, no direct pushes (owner included — pre-commit already enforces locally), require 1 review for external PRs, owner PRs can self-merge | 0.25d (Darlene) |

Total ≈ 3 IC-days. All is prep work — shippable now, inert until gates open.

## 2. Staged gate-opening (recommendation)

**Stage 1 (open now on approval): docs + themes + provider definitions.**
- `docs/`, theme CSS, and `PROVIDER_DEFINITIONS` entries in `registry.ts` are low-blast-radius, high-appetite (exactly what the Obsidian community contributes). Each entry is data, not logic — reviewable in minutes.
- Guardrail: new provider definitions ship behind `experimental: true` flag until smoke-tested.

**Stage 2 (after 4 weeks or 20 merged community PRs, whichever first): MCP bridges + commands.**
- New MCP tool wrappers and palette commands — still additive, touches no core contracts.

**Stage 3 (deliberately last, maybe never): core engine (`src/core`, `src/chat/view.ts`, transport).**
- Core stays owner-only until there's a maintainer bench beyond Jordan. State this explicitly in ARCHITECTURE.md so contributors self-select correctly.

**Rationale:** the pipeline should be shaped to favor **MCP-server direction** over headless-core porting (per the strategic question surfaced separately): contribution surface = tools and bridges around a stable core, not a portable engine that invites fork pressure. Stage 3's closure encodes that.

## 3. What we are NOT doing

- No CLA (legal surface not worth it at this scale; DCO suffices).
- No hosted community infra (Discord server, etc.) in this package — social surface is a separate decision.
- No bounty/label automation bots until triage volume is real.

## 4. Go/No-Go asks (Jordan's checkboxes)

1. ☐ Approve Stage 1 gate-opening (docs/themes/provider-defs) — target date?
2. ☐ Approve DCO over CLA.
3. ☐ Approve branch protection incl. "no direct pushes to master" for owner too (currently symbolic — pre-commit already gates you).
4. ☐ Note the strategic lean: pipeline favors MCP-bridge contributions over core porting.

**Recommendation: GO on all four.** The CI is already stricter than most community repos; the risk of Stage 1 is near zero and the goodwill is real.
