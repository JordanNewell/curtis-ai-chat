---
title: "Kill the free tier"
date: 2026-07-19
status: decided
decision: remove free tier entirely, replace with 14-day trial
reversibility: hard (free users are future paying users; burning the pipeline)
tags: [decision, growth, monetization]
---

# 2026-07-19 — Kill the free tier

## Context

Pylon's free tier was launched in March 2026: 100K monthly invocations, 1 dev seat, 7-day retention. Today there are 1,847 free users and 23 paying customers. Conversion rate: 1.2%. Industry benchmark for dev tools at our stage: 3-5%.

The free tier is doing one of two things: (a) failing to convert for fixable reasons, or (b) actively attracting the wrong audience (free-forever seekers who will never pay).

After three months of optimization attempts — better in-app upgrade prompts, email lifecycle, free→paid feature gating experiments — conversion hasn't moved.

## The number that decided it

Average revenue per free user over 6 months: $0.42.
Average cost per free user over 6 months: $1.18 (infra + support + onboarding emails).
Net per-user: -$0.76. Multiplied by 1,847 users = **-$1,400/month.**

That's $16.8K/year of loss, which is 17% of revenue. For a tool that should have ~80% gross margin.

## Decision

**Kill the free tier. Replace with a 14-day trial (no credit card, full feature access, automatic downgrade to read-only on day 15).**

Existing free users get 60 days of full access as a thank-you, then convert to trial-or-paid model on next login.

## Why a trial over a smaller free tier

- **Smaller free tier** (e.g., 10K invocations) — still attracts the same free-forever audience, just slower.
- **Trial** — forces the decision. Anyone who won't decide in 14 days isn't going to decide in 14 months either. Trial also matches how developers actually evaluate tools (try hard for a week, decide, move on).
- **Removes ambiguity.** "Is this worth $19/month?" becomes the question, not "can I stretch the free tier?"

## Risks

- **Sign-up volume drops.** Realistically, expect 40-60% drop in new signups. The bet: those who do sign up are qualified.
- **Angry existing free users.** Some will leave. CS plan: outbound to top 50 (by usage) before the change, offer 50% off first 3 months.
- **SEO / discoverability hit.** Less traffic to the landing page. Mitigate by writing more comparison content, getting on "alternatives to X" lists.
- **Investor perception.** If we raise, investors will ask "why did you kill growth?" Need a clean narrative.

## What I'd tell a friend

> "Free tier was costing me 17% of revenue in net-negative users. Trial instead. Signup volume will crater but conversion will 5x. If the math doesn't work in 90 days, I'll bring back a smaller free tier with stricter gating."

## 90-day review

- [ ] Check 2026-10-19: signup volume, conversion rate, paid-customer acquisition cost
- [ ] If paid CAC < $40 and conversion > 8%, the bet won
- [ ] If conversion < 5%, revisit a smaller free tier
