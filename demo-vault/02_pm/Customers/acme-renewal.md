---
account: Acme Corp
arr: 48000
tier: Growth
renewal-date: 2026-09-30
status: at-risk
owner: marcus.chen@anchor.app
cs-owner: jordan.lee@anchor.app
tags: [customer, renewal, at-risk]
---

# Acme Corp — Renewal Cycle

## Account summary

- **ARR:** $48K (140 seats, Growth tier)
- **Renewal:** 2026-09-30 (68 days out)
- ** Champion:** Riley Park, Director of Engineering
- **Decision maker:** Riley (small org, no procurement gate)
- **Usage:** Steady for 9 months, dropped 22% in last 60 days

## Why at-risk

Riley raised two specific concerns in the last QBR (2026-07-10):

1. **"We can't see who's using what."** Admin dashboard request — this is exactly what [[usage-analytics-v2]] will solve. Riley offered to be a design partner if we can land it before renewal.
2. **"Onboarding new hires is still painful."** Acme onboards ~3 engineers/month. Their onboarding doc references Anchor but the in-product first-run doesn't match. This is the [[q3-onboarding-overhaul]] work, slated to ship 2026-09-15.

## Renewal strategy

**The bet:** If we can land v2 analytics + onboarding overhaul before 2026-09-30, Riley renews at +20% (expansion to 168 seats for new hires). If not, downsize renewal to ~$36K (90 seats) or churn.

**Timeline:**
- Onboarding overhaul ship: 2026-09-15 (per PRD)
- v2 analytics ship: 2026-10-15 (per PRD) — **too late for renewal**
- Internal discussion: can we pull v2 analytics MVP (admin dashboard only, no scheduled reports) forward to 2026-09-15?

## CS plan (Jordan Lee driving)

- Weekly check-ins with Riley through renewal
- Demo v2 analytics MVP the moment it's dogfoodable
- Offer design-partner discount (5% off renewal) if Riley commits to monthly feedback calls

## Open questions

- [ ] Can we pull v2 analytics MVP forward 4 weeks? Asking Priya in next eng sync.
- [ ] Does the design-partner discount set a bad precedent for other renewals?
- [ ] Backup plan if Riley leaves Acme — who's the secondary champion?

## Conversation log

### 2026-07-10 — QBR with Riley

- Flagged the two concerns above
- Riley explicitly said "I'd renew tomorrow if I could see usage"
- Sent the [[usage-analytics-v2]] PRD draft for feedback (Riley provided 3 specific comments, all incorporated)

### 2026-07-17 — Quick sync

- Riley's team started a project migration from Jira → Anchor
- Good signal — they're investing in adoption, not exploring alternatives
- Confirmed renewal conversation for 2026-09-15

## Related

- [[usage-analytics-v2]]
- [[q3-onboarding-overhaul]]
