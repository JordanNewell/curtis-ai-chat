---
title: "Q3 2026 roadmap"
last-updated: 2026-07-22
owner: alex@pylon.example
quarter: 2026-Q3
tags: [roadmap, product, planning]
---

# Q3 2026 roadmap

## North star

Get from $8K MRR to $15K MRR by end of Q3. Path: ship the language coverage I've been deferring, then lean on the new pricing model (per-usage) to extract more value from existing accounts.

## Themes

1. **Language coverage** — Python and Go support. Today we're Node-only; that's capping our TAM.
2. **Enterprise readiness** — SOC 2 Type II. Required for any deal >$50K ARR.
3. **Self-serve onboarding** — kill the free tier means trial quality matters more.

## In-flight

### Python support

- **Owner:** me (hiring didn't pan out, see [[series-se-prospects]])
- **Status:** prototype working, needs instrumentation pass + docs
- **Ship date:** 2026-08-15
- **Risk:** if I can't get error context parity with Node, push to 2026-09-01

### Go support

- **Owner:** contractor (start 2026-08-01)
- **Status:** scoped, waiting on contract
- **Ship date:** 2026-09-15
- **Risk:** contractor reliability. Backup: I do it after Python ships.

### SOC 2 Type II

- **Owner:** Vanta (tooling) + me (evidence collection)
- **Status:** scoping call 2026-07-30
- **Ship date:** Type I by 2026-09-30, Type II by Q1 2027
- **Risk:** this is a 6-month process, not a sprint. Need to start now to land Type I in Q3.

### Trial flow

- **Owner:** me
- **Status:** designed, ready to implement
- **Ship date:** 2026-08-01 (after [[2026-07-19-kill-free-tier]] decision)
- **Risk:** low. Just execute.

## Stretch (Q3 if time, Q4 otherwise)

### Customer-facing analytics

- Per-service error rates, top 5 services by error count, week-over-week trend
- Defer unless a whale asks

### Slack native notifications

- Currently email + webhook. Slack is the #1 integration request.
- 2 weeks of work. Do it if [[acme-renewal]]-type account asks.

## What I'm not doing

- **Mobile app.** Asked for by 4 customers. None are paying >$100/mo. Defer.
- **AI error grouping.** Cool feature, no clear ROI. Punt to Q4.
- **Multi-region support.** 1 customer needs it, they're tiny. Wait until someone bigger asks.

## KPIs (weekly check-in)

| Metric | Target Q3-end | Current |
|---|---|---|
| MRR | $15K | $8K |
| Customer count | 45 | 23 |
| Gross retention | >95% | 91% |
| Net retention | >110% | 104% |
| Python GA | yes | prototype |
| SOC 2 Type I | yes | scoping |

## Risks I'm watching

1. **Solo burnout.** Doing eng + GTM + CS + fundraising-prep solo. Burnout risk is real. Mitigation: contractor for Go work, part-time VA for CS scheduling.
2. **Churn from pricing change.** [[2026-07-01-pricing-flip]] is only 4 weeks old. Won't know conversion impact for 60 more days.
3. **Competitor moves.** Sentry shipped something similar last month. Watching their launch closely.

## Weekly review (Fridays)

- [ ] Update KPI table
- [ ] Review the previous week's commitments
- [ ] Pick one stretch item to attempt next week
- [ ] Write a one-paragraph journal entry
