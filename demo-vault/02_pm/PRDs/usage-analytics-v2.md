---
title: "Usage Analytics v2"
status: draft
owner: marcus.chen@anchor.app
target-ship: 2026-10-15
tags: [prd, analytics, q4]
last-updated: 2026-07-19
---

# PRD: Usage Analytics v2

## Context

Current analytics surface shows top-line metrics (DAU, projects created, MAU). **Customers can't see their own usage** — a consistent request from enterprise accounts during renewal cycles. Admins want to know who in their org is using what, so they can manage licenses and identify champions.

## Problem

Two problems, both revenue-blocking:

1. **Renewal friction.** Every renewal conversation includes a manual "let me pull the usage data for you" email from CS. Adds 3-5 days to cycle.
2. **Expansion blocker.** When admins can't see usage, they default to license-count thinking. When they can, they identify teams that need more seats.

## Success metrics

| Metric | Current | Target |
|---|---|---|
| CS manual usage-report requests per week | 14 | <3 |
| Renewal cycle time | 21 days | 14 days |
| Self-serve license upgrades per month | 6 | 12 |

## Scope

### v2.0 (this PRD)

- Admin-only dashboard: per-user activity (login freq, projects touched, last active)
- Per-project engagement: views, edits, comments by user
- Export to CSV (no PDF in v2)
- Date range filters: 30/90/365 days
- Access control: `admin` role only. Editor/Viewer roles get nothing new.

### v2.1 (next quarter)

- Scheduled email reports (weekly/monthly)
- Benchmark vs. industry (anonymized aggregate)
- API access for data warehouse sync

### Out of scope

- Predictive churn scoring — needs ML investment, defer to v3
- Real-time presence (online now) — different problem, owned by Platform team

## Risks

- **Privacy backlash.** Some users will dislike being tracked at this granularity. Mitigation: per-user detail only available to admins, not exposed to managers. Anonymous aggregation available to broader roles.
- **Pricing implications.** Should this be in base plan or premium tier? Pricing team deciding separately.
- **Storage cost.** 18 months of per-user event data is non-trivial. Eng estimating now.

## Open questions

- [ ] GDPR / data residency implications for EU customers? Legal reviewing.
- [ ] What's the right cadence for "active" — login? Edit? Project touch?
- [ ] How do we handle users who leave the org? Anonymize? Delete? Retain?

## Dependencies

- Platform API work for event ingestion (slated for 2026-09)
- Admin role permissions refactor (in flight)

## Related

- [[q3-onboarding-overhaul]] — shares the activation tracking infrastructure
