---
title: "Q3 Onboarding Overhaul"
status: in-review
owner: marcus.chen@anchor.app
target-ship: 2026-09-15
tags: [prd, onboarding, q3]
last-updated: 2026-07-22
---

# PRD: Q3 Onboarding Overhaul

## Context

Current onboarding is a 7-step wizard that finishes in ~6 minutes but **only 31% of new accounts complete it**. Of those who finish, 60% create their first project within 24 hours. Of those who don't finish, only 8% do.

The wizard is the problem. The Activation team's hypothesis: replace the wizard with a **product-led first-run** that gets the user to value (first project created) in under 90 seconds.

## Problem

Activation rate (defined as: project created within 24h of signup) is 38%. Industry benchmark for B2B SaaS at our price point is 55-65%. The gap is worth ~$1.2M ARR annually at current acquisition velocity.

## Success metrics

| Metric | Current | Target | Measurement |
|---|---|---|---|
| Wizard completion | 31% | n/a (wizard removed) | funnel |
| 24h activation | 38% | 55% | product analytics |
| Time to first project | ~6 min | <90 sec | session replay sampling |
| D7 retention | 42% | 50% | cohort analysis |

Non-goal: improving wizard completion. We're removing the wizard.

## Scope

### In scope (MVP)

1. **First-run experience** — replaces wizard. Three screens: connect repo, invite teammate (skippable), create first project. No setup choices until after first project.
2. **Empty-state CTAs** — every surface with no data has a 1-click CTA to a meaningful next step.
3. **In-product hints** — contextual tooltips on first interaction with each major surface. Dismissible.
4. **Activation tracking** — instrument the new funnel, define activation event as `project_created`.

### Out of scope (later quarters)

- Email lifecycle nurture (owned by Growth, separate roadmap)
- In-app video tutorials (waiting on video team)
- Slack onboarding integration (depends on platform API work)

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Users skip first-project step entirely | Medium | High | Gate advanced features behind first project |
| Existing users confused by hints | Low | Medium | Hints only fire for accounts <7 days old |
| Activation instrumentation lag | Medium | High | Ship tracking 1 week before UX changes |
| Engineering underestimates empty-state work | High | Medium | Time-box empty states to 2 sprints max |

## Open questions

- [ ] Do we keep the wizard as a fallback for enterprise customers with SSO? Eng feedback needed.
- [ ] What's the policy on users who already partially completed the wizard? Migrate them or restart?
- [ ] Pricing page A/B test intersects this — does activation lift change if pricing page changes?

## Timeline

- **2026-08-01:** Eng kickoff, tracking instrumentation lands
- **2026-08-15:** First-run MVP behind feature flag
- **2026-08-29:** Internal dogfood
- **2026-09-12:** 25% rollout
- **2026-09-26:** 100% rollout (assuming metrics hold)

## Related

- [[2026-07-18-engineering-sync]] — eng review notes
- [[usage-analytics-v2]] — tracking dependency
- [[acme-renewal]] — customer requesting this exact change
