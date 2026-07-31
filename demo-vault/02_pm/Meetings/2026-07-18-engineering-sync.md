---
title: "Eng sync — onboarding overhaul kickoff"
date: 2026-07-18
attendees: ["marcus.chen (PM)", "priya.singh (eng lead)", "diego.alvarez (eng)", "sam.tanaka (design)"]
tags: [meeting, eng-sync, onboarding]
---

# 2026-07-18 — Eng sync, onboarding overhaul kickoff

## Context

Walking through the [[q3-onboarding-overhaul]] PRD with the eng + design leads. Goal: align on scope, surface eng concerns, lock the timeline.

## Discussion

### Scope alignment

- Priya: "The first-run MVP is doable in 3 sprints if we cut the repo-connector variant — just do GitHub for v1, add GitLab in v2."
- Marcus: Agreed. GitLab is 8% of our base, can wait.
- Sam: Empty states are 12 surfaces. Realistic? Or batch?
- Priya: Batch by surface type. Lists first (3 surfaces), then boards (3), then views (6). Stagger across sprints.
- Decision: scope reduced to GitHub-only connector + 6 empty states for v1.

### Tracking

- Diego: "Instrumentation is bigger than it looks. We need to add `project_created` as a top-level event, not just `project.create` API call. Different signal."
- Marcus: Open question — what's the audit trail implication?
- Priya: Tag with @analytics-platform team for review by 2026-07-25.

### Risks

- Existing-user migration: how do we handle accounts that finished the wizard but never created a project? Priya to draft a migration matrix by 2026-07-22.
- Enterprise SSO fallback: defer decision to next eng sync (2026-08-01). Don't block MVP.

## Decisions

- [x] **GitHub-only connector for v1.** GitLab in v2.
- [x] **6 empty states in v1** (3 lists, 3 boards). Views in v1.1.
- [x] **Tracking event `project_created`** added to event taxonomy. Diego to PR by 2026-07-22.
- [ ] Enterprise SSO fallback — decision deferred to 2026-08-01.

## Action items

- [ ] @marcus Update PRD with scope reduction (GitHub-only, 6 empty states)
- [ ] @priya Draft existing-user migration matrix by 2026-07-22
- [ ] @diego `project_created` event PR by 2026-07-22
- [ ] @sam Empty-state design review schedulued 2026-07-25
- [ ] @marcus Tag analytics-platform team re: audit trail

## Followups for next sync (2026-08-01)

- Enterprise SSO fallback decision
- Migration matrix review
- Tracking PR review

## Related

- [[q3-onboarding-overhaul]] — the PRD under review
