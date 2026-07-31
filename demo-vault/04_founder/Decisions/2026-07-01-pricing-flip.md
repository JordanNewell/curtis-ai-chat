---
title: "Pricing flip — move from per-seat to usage-based"
date: 2026-07-01
status: decided
decision: usage-based pricing, $0.40 per million invocations
reversibility: medium-hard (reversing means re-pricing every account)
tags: [decision, pricing, monetization]
---

# 2026-07-01 — Pricing flip to usage-based

## Context

Pylon is currently priced per-seat: $29/dev/month, $99/team-month (5 dev seats), $299/company-month (20 seats). For a serverless tool, this is misaligned — the cost we incur is per invocation (Lambda calls), not per developer. A customer with 2 devs and 50M monthly invocations pays $58/month and costs us $9 in infra. A customer with 20 devs and 1M invocations pays $299/month and costs us $0.20.

The 80/20 is inverted. Our most expensive customers pay the least.

## Options considered

### A. Stay per-seat

- Pros: predictable revenue, simple sales conversation, matches what competitors do
- Cons: misaligned economics, caps upside on the best accounts, retention risk if a whale reduces dev headcount

### B. Pure usage-based ($X per million invocations)

- Pros: perfectly aligned with cost, customers pay for value received, no per-seat ceiling
- Cons: revenue unpredictable, customers hate unpredictable bills, hard to forecast

### C. Hybrid — base platform fee + usage

- Pros: floor on revenue, still upside on usage, easier sales conversation
- Cons: more complex to explain, two dials to optimize

### D. Tiered usage bands

- Pros: predictable for customer (they pick a tier), still aligned with cost
- Cons: encourages tier-shopping, customers game the boundaries

## Decision

**Option B: pure usage-based at $0.40 per million invocations.**

Floor: $19/month minimum (covers infra + accounting overhead).
Ceiling: $2,999/month cap (so whales don't get scary bills; we eat the variance above).

## Why B over C or D

- **Simplicity.** I can explain it in one sentence. Sales conversations shrink.
- **Cost alignment.** When infra cost goes up, revenue goes up. When we optimize infra, margin expands without renegotiating contracts.
- **The cap mitigates the only real risk** (scary bills for whales). $2,999/month is a number most companies approve without escalation.

The hybrid (C) is what competitors do. Reading their customer reviews, the most common complaint is "I can't predict my bill." Pure usage with a hard cap is a differentiator.

## Risks

- **Predictability for me.** MRR drops ~$8K → ~$5K initially. Recovery time: 3-4 months as usage grows. Have runway.
- **Customer pushback.** ~30% of accounts will see higher bills. CS plan: outbound to each before the change, 60-day transition at lower of old/new price.
- **Cap pressure.** If 3 customers hit the cap simultaneously, margin compresses. Acceptable risk at current scale; revisit at 100 customers.

## How to reverse

- All accounts revert to old per-seat pricing on a date we publish
- Grandfather existing usage-based accounts for 6 months
- Cost: probably $5-8K in CS time, lost trust with 2-3 accounts

## What I'd tell a friend

> "I flipped to usage-based because the per-seat model was paying me less for my best customers. The cap means no scary bills. Three months in, MRR is up 40% on the same customer count."

## 90-day review

- [ ] Check 2026-09-30: did MRR recover? Did churn spike? Did NPS move?
