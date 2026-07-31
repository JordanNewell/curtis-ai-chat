---
title: "What I learned shipping an AI tool at a 12-person startup"
kind: blog-post
client: Vector Mag
target-words: 1800
current-words: 1102
status: draft-1
due: 2026-07-29
tags: [draft, non-fiction, blog, vector-mag]
---

# What I learned shipping an AI tool at a 12-person startup

**Client:** Vector Mag (tech column)
**Editor:** Casey Park
**Length:** 1800 words
**Angle:** Personal essay + practical takeaways. First-person, present tense for the in-story moments.

## Draft 1

I joined Hildegard as employee number eleven in March of last year. Hildegard made an AI assistant for legal teams — drafting contract clauses, flagging risky language, summarizing case law. The tech was unremarkable; everyone in legal AI was building some version of it. The bet was that we could ship faster than the incumbents.

We did. In fourteen months we shipped more features than the three companies ahead of us combined. We didn't do it by working harder. We did it because we'd built an internal tool that wrote 60% of our boilerplate for us.

This is what I learned.

### The tool was not the product

We called it Forge. It started as a side project by our staff engineer, Maya, who was tired of writing the same Express middleware for the fifth time. She trained a small model on our codebase — just ours, no external data — and within a week it could scaffold a new endpoint with auth, validation, error handling, and tests. Not well. But enough to start.

Within a month, half the engineering team was using Forge. Within three months, all of us were. The interesting thing is what we did with the time it gave back.

Some teams used it to ship more features. Some used it to refactor technical debt. Maya's team — the platform team — used it to build a second internal tool. By the time I left, we had four.

The point isn't that AI makes you faster. The point is that speed is a function of what you choose to spend the time on. Some teams will spend it on more of the same. Some will spend it on compounding investments. The tool doesn't decide which.

### The hardest part was trust

Engineers did not believe Forge's output. Even when it was right.

The pattern was universal: an engineer would ask Forge to scaffold something, get a working result, then spend twenty minutes reading every line looking for the bug. The bug was rarely there. They were really looking for permission to trust it.

The breakthrough came when Maya added a feature that showed, for each line of generated code, the closest precedent in our actual codebase. *This is line 47 of `auth/middleware.ts` with the variable names changed.* Suddenly engineers could pattern-match against code they'd already approved. Trust came in the back door.

This is the most underrated lesson I took from Hildegard. AI tools that hide their reasoning fail. AI tools that show their work — even clumsily — succeed.

### The cost was the conversations we didn't have

Here's the part I've been avoiding.

When you can scaffold a feature in an afternoon, you scaffold a lot of features. You also stop having the conversations you used to have. The ones like: "do we actually need this?" Or: "is this the right feature?" Or: "what would happen if we didn't ship anything this sprint?"

We shipped more. We thought less. Not individually — individually, we were all still thinking hard. But collectively. The cadence of debate slowed down. We didn't notice for almost a year.

The product that resulted was bigger, faster, more feature-rich. It was also less coherent. Customers told us so. The churn we saw in Q1 was, I'm now convinced, a direct consequence.

AI tools don't replace thought. They defer it. The cost shows up later, in places you didn't expect.

### What I'd do differently

[continue here — 700 words to go]

## Revision notes

- The "tool was not the product" section is the strongest. Don't bury it.
- "The cost was the conversations we didn't have" — this is the emotional center. Give it more room.
- "What I'd do differently" needs concrete tactics. Currently hand-wavy.
- Cut "the tech was unremarkable" — undercutting your own subject. The reader is here for the AI tool.
- Title TBD. Editor suggested "What I Learned Shipping AI at a Startup" — too generic. Pitched back: "The Tool That Wrote Itself: 14 Months at Hildegard." Editor pushed back: too poetic for Vector. Compromise candidate: "What an AI Tool Taught Me About Conversation."
- Due 2026-07-29. Casey wants final by EOD.
