# Curtis AI — 4-Week Marketing Blitz Plan

Companion to [obsidian-user-groups.md](obsidian-user-groups.md). Anchored to Monday 2026-10-12. Adjust dates if you start later; the sequencing is what matters.

**The plan in one sentence:** spend four weeks making one audience per week happy, in order of influence — technical tastemakers first, then volume segments, then amplifiers — with one tailored post per channel, every comment answered, and zero spend.

---

## 1. Objectives and KPIs

Per [MONETIZATION.md](../docs/MONETIZATION.md) the plugin's job is **maximum adoption**. The blitz serves three concrete goals:

| Goal | Metric | Where to check | 30-day target |
|---|---|---|---|
| Get into the official community plugin directory | PR merged in `obsidianmd/obsidian-releases` | GitHub PR | Submitted week 0, merged within 30 days |
| Build the star signal that triggers product #2 scoping | GitHub stars | repo | 100–150 stars (stretch: 500 is the long-term signal) |
| Prove the funnel works | Installs | obsidianstats.com plugin page (weekly downloads) | 1,500–3,000 downloads in 30 days |
| Seed the audience asset | Discussions threads, issues, external mentions | GitHub Discussions, Google Alerts on "Curtis AI obsidian" | 10+ substantive threads |

Modest on purpose. Copilot took ~3 years to reach ~1M downloads. What week 1 actually tests is **message-market fit per segment** — the numbers tell you which segment to double down on in weeks 5–8.

---

## 2. Positioning and message pillars

**Positioning line (use everywhere):**

> The AI that stays in your vault and asks permission.

**Three pillars. Every post runs on exactly one — never all three.**

| Pillar | Claim | Proof asset | Segment |
|---|---|---|---|
| **Trust** | Local-first, BYOK, keys in OS keychain, memory asks before saving, conversations are plain markdown files | Memory GIF (Save/Skip on every fact) | Privacy pros, journalers, academics |
| **Power** | 41 providers, agent with 11 vault tools + MCP, named agents with tool ceilings, multi-model arena | Arena demo GIF (one prompt, two models, promote the winner) | Developers, PKM power users, model tinkerers |
| **Flow** | Autocomplete ghost text, Cursor-style diff rewrite, @-mention any note, voice I/O, /recap journal | Diff-rewrite screenshot or autocomplete GIF | Writers, students |

**One-liners per segment** (from the research doc — these are your post titles and openers):

- Developers: "Your vault is a codebase. Give the agent read/write access with ceilings you control."
- PKM power users: "An AI that operates inside the system you built — and asks before it remembers anything."
- Students: "Chat with your literature notes. Run it on a free local model while you're at it."
- Writers: "Edit in place. Accept or reject the diff. Your prose is never silently overwritten."
- Journalers: "Your AI remembers yesterday — /recap writes the summary into your journal for you."
- Privacy pros: "Fully private, free, offline AI. Nothing leaves your machine."
- GMs: "A lore librarian that has actually read your campaign notes."
- Migrators: "Cancel the subscription shuffle. Bring your own keys, import your ChatGPT history."

---

## 3. Who / What / When / Where — the master matrix

| When (2026) | What | Where (channel) | Who (segment) | Pillar | Asset |
|---|---|---|---|---|---|
| Sat 10 – Sun 11 Oct | Prep: assets, drafts, **submit directory PR** | GitHub | — | — | checklist §6, §7 |
| Tue 13 Oct, 8–10am ET | **Launch post** | r/ObsidianMD | PKM power users + devs | Power | full post §5.1 |
| Wed 14 Oct | Showcase thread | forum.obsidian.md (Share & showcase) + Obsidian Discord | power users | Power | §5.2, §5.3 |
| Thu 15 Oct | Reply day + participate in 3 unrelated threads | r/ObsidianMD, r/PKMS | same | — | rules §8 |
| Fri 16 Oct | Retro #1 | — | — | — | §9 |
| Mon 19 Oct | Local-AI post | r/LocalLLaMA | devs, privacy pros | Trust | §5.4 |
| Tue 20 Oct | Comment-seeding in "AI tools" threads | r/gradschool, r/PhD | students | Trust+Flow | §5.6 |
| Wed 21 Oct | Campaign-post | r/DMAcademy | TTRPG GMs | Power | §5.5 |
| Thu 22 Oct | X/Twitter thread | X | devs/indie hackers | Power | §5.8 |
| Fri 23 Oct | Retro #2 | — | — | — | §9 |
| Mon 26 Oct | **Show HN** | news.ycombinator.com | devs | Trust | §5.7 |
| Tue 27 Oct | Creator outreach (5–8 emails) | email/DM | audience owners | — | §5.9 |
| Wed 28 Oct | Ollama ecosystem post | r/ollama, Ollama Discord | local-AI users | Trust | short variant of §5.4 |
| Thu 29 Oct | Newsletter pitches | Obsidian Roundup et al. | everyone | — | §5.10 |
| Fri 30 Oct | Retro #3 | — | — | — | §9 |
| Mon 2 Nov | Follow-up workflow post (arena deep-dive, not a re-launch) | r/ObsidianMD | tinkerers | Power | §5.1 variant |
| Tue 3 Nov | Upload your own 3–5 min YouTube demo | YouTube | everyone | all | §6 |
| Wed 4 Nov | Creator follow-ups; support any creator content | — | — | — | — |
| Thu 5 Nov | "30 days of Curtis" transparency post | forum + GitHub Discussions | early adopters | — | §9 |
| Fri 6 Nov | Final retro; plan weeks 5–8 from data | — | — | — | §9 |

**Posting time rule:** Reddit and HN — Tuesday–Thursday, 7–10am ET. Forum and Discord — weekday mornings EU or US both work. Never launch-post on weekends.

---

## 4. The funnel

Every post points to **one** link. No link trees.

1. **During directory review (weeks 0–N):** GitHub repo — the README quick-start already carries install (releases + BRAT) and the 60-second Ollama path.
2. **After merge:** Obsidian's in-app community plugin store becomes the CTA. Update pinned posts/comments with the store name once live.

Supporting layer: the GitHub Pages site (jordannewell.github.io/curtis-ai-chat) for people who bounce off the README.

---

## 5. Channel playbooks with example posts

### 5.1 r/ObsidianMD — the launch post (full walkthrough)

This is the single highest-leverage hour of the blitz. r/ObsidianMD is where groups 1, 2, 5, and 7 all read.

**Step-by-step:**

1. **Mon evening (day before):** draft the post, upload images to Reddit's native image uploader (Reddit does not render external markdown images in posts — upload the arena GIF and 2–3 screenshots directly). Draft 3 title options, pick in the morning. Re-read the sub's rules that day; they occasionally change self-promo guidance.
2. **Tue 7:55am ET:** post with flair "Showcase" (or whatever the sub's plugin flair is).
3. **8am–noon ET:** stay in the thread. Answer everything within the hour. Speed of dev replies is the single biggest driver of upvotes and store-installs on launch posts — it signals the plugin is alive.
4. **Noon:** one edit to the post adding an FAQ section built from the morning's questions.
5. **Evening:** reply to anything new. Save every question asked — they become README FAQ entries and next week's comment seeds.
6. **Wed–Fri:** check the thread twice a day. Reddit launch threads keep surfacing for ~72h.

**Title options (pick one, A/B against your gut — titles do 80% of the work):**

1. "I built a free, local-first AI chat plugin for Obsidian — 41 providers, an agent that can edit your vault, and a multi-model arena"
2. "Curtis AI v2.0 — polyglot AI chat for Obsidian: agent mode with vault tools + MCP, arena mode, memory that asks before saving. Free and MIT."
3. "I wanted AI chat in my vault that doesn't phone home — so I built it: BYOK across 41 providers, Ollama support, agent tools, and an arena to compare models side by side"

**Body (ready to paste — adjust wording to your voice):**

> I'm the developer. Curtis AI is free and open source (MIT), and every feature works with your own API keys — or with no keys at all if you run Ollama.
>
> **What it does:** AI chat in the Obsidian sidebar, with your vault one `@` away.
>
> - **41 providers, one settings pane** — Anthropic, OpenAI, Gemini, DeepSeek, Groq, OpenRouter, or any OpenAI-compatible endpoint. Plus **Ollama/LM Studio for fully local, offline chat** — nothing leaves your machine.
> - **Agent mode** — the model can read, search, create, and edit notes (11 built-in tools), and you can connect MCP servers you already run. Tool access is opt-in and capped.
> - **Named agents** — give a model a role with its own tool ceilings: an Editor on Claude that can read but not write, a Librarian on local Ollama that never touches the network.
> - **Multi-model arena** — stream one prompt to 2–4 models side by side, stop the losers, promote the winner to a normal chat.
> - **Memory with provenance** — proposed facts appear after a turn and nothing persists until you tap Save; every fact remembers which conversation it came from.
> - **Conversations are markdown files** in your vault — synced, searchable, and readable by the agent.
> - Also: inline autocomplete, Cursor-style diff rewrite, voice in/out, /recap journal, multi-pane chats, import from ChatGPT/Claude exports.
>
> **What it doesn't do:** no cloud service of mine in the middle — you bring keys (or run local), so usage costs are whatever your provider charges. No telemetry.
>
> Install and a 60-second Ollama quick start are in the README: <link>
>
> Happy to answer anything — feature requests and bug reports go in the GitHub issues or right here.

**The four replies you should have ready** (these questions come up on every AI-plugin launch post):

- **"How is this different from Copilot / Smart Connections?"** — Be generous, never punch: "Those plugins validated the category and Copilot is genuinely good. Curtis differs in three ways: it's BYOK-first across 41 providers including local Ollama; the agent/permission model (named agents with tool ceilings, memory that asks before saving); and the arena for comparing models on the same prompt. Conversations also live as ordinary markdown notes in your vault. Different taste, same category — try both."
- **"What data leaves my machine?"** — Precision wins this segment: "Only what you explicitly send: your prompt, plus note content you @-mention or the agent reads as a tool result. It goes to whichever provider you selected for that chat. If the provider is Ollama or LM Studio, nothing leaves your machine. API keys are stored in your OS keychain, not in the vault."
- **"Do I have to pay?"** — "The plugin is free, MIT, all features included. You pay your provider for tokens if you use a cloud model — or nothing at all on a local model (the README has a 60-second Ollama quick start). Sponsorship is voluntary."
- **"Does it work on mobile?"** — "Yes, the plugin is mobile-capable; chats persist as vault notes so they sync across devices. Multi-pane and the arena are desktop-first."

**Do NOT:** cross-post the same text to other subs; mention downvotes/upvotes in comments; argue with the one guy who says AI in Obsidian is a mistake — upvote-visible courtesy beats winning.

### 5.2 Obsidian Forum — "Share & showcase" thread (full example)

The forum has a dedicated Share & showcase category; one thread per plugin, and the thread becomes the plugin's permanent support surface.

> **Title:** Curtis AI — polyglot AI chat: 41 providers, agent with vault tools + MCP, multi-model arena, local-first
>
> Body: same content as the Reddit post, minus the "I'm the developer" opener (the forum knows who posts their own plugins), plus a line on the version history: "v2.0.0 just shipped — multi-pane chats, ChatGPT/Claude chat import, and the .curt portable conversation format. Changelog: <link>."
>
> End with: "Roadmap and docs are in the repo. If you hit an install problem, post here and I'll walk you through it."

**Steps:** post Wed 14 Oct morning → watch the thread weekly → answer support questions here before pointing people to GitHub issues (the forum rewards patience).

### 5.3 Obsidian Discord — showcase blurb (short)

Post in the appropriate showcase/plugin channel per the server's rules. Two sentences max, one image, one link:

> Released: Curtis AI v2.0.0 — AI chat with agent mode (vault tools + MCP servers), a multi-model arena, and memory that asks before saving. BYOK across 41 providers, or fully local via Ollama. Free, MIT. <link>

Also join plugin-dev conversations genuinely during week 1 — the Obsidian Discord is small; being a known, helpful presence before you promote matters more than any post.

### 5.4 r/LocalLLaMA — the local-first post (full example)

Angle: this sub doesn't tolerate app advertisements, but it loves a well-documented local setup. Lead with the setup, not the plugin.

> **Title:** Running a fully local AI assistant over my Obsidian notes — my setup (qwen2.5 on Ollama + agent tools)
>
> I've been running my note-taking AI entirely offline and wanted to share the setup, since the pieces finally work well together:
>
> 1. **Ollama** with `qwen2.5:7b-instruct` (anything tool-calling works; I get ~25 tok/s on a modest GPU)
> 2. **Curtis AI**, an open-source Obsidian plugin I wrote (MIT, no telemetry) — it's BYOK/local-first, so the model never sees anything beyond what a given chat sends. When the provider is Ollama, nothing leaves the machine.
> 3. The agent gets 11 vault tools (read/search/create/edit notes, backlinks, tags) plus MCP servers, all permission-capped — so a local 7B can actually reorganize notes for me instead of just chatting.
>
> The part that surprised me: a 7B with tool access beats a frontier model without it for vault work, because the notes are the context.
>
> Setup details and the 60-second quick start: <link>. Happy to answer questions about the tool-calling implementation too.

**Steps:** Mon 19 Oct, 8am ET → same reply discipline as Reddit launch → expect harder technical questions (quantization, context length, embeddings); answer precisely, it builds credibility with exactly the people who write the most posts.

### 5.5 r/DMAcademy — the GM post (full example)

Angle: campaign prep story first, tool second. This sub rewards usefulness and punishes ads.

> **Title:** My AI "lore librarian" reads my entire campaign vault so my players can't catch me contradicting myself
>
> I run a homebrew campaign with ~200 notes of factions, NPCs, and house rules. My problem was never writing lore, it was **remembering** it mid-session — "wait, what did I decide the Silver Pact's password was three months ago?"
>
> My fix: an open-source Obsidian plugin (I'm the author) that gives the AI read access to the vault as tools. Now in prep I ask things like "summarize every established fact about Kaelen the harbormaster, with the note it came from" and get answers with provenance, because it searches the actual notes instead of guessing.
>
> Two rules I set: the agent can **read but not write** (lore stays canon unless I change it), and I run it on a local model so nothing about the campaign goes to a cloud.
>
> It's free (MIT): <link>. If there's interest I'll do a follow-up on the exact vault structure and prompts I use for session prep.

**Steps:** Wed 21 Oct → deliver the promised follow-up regardless of traction (it's evergreen content and r/DMAcademy indexes well). Cross-post variant for the Obsidian TTRPG community's own channels with their permission norms.

### 5.6 r/gradschool + r/PhD — students (comment-seeding, not posts)

Most academic subs restrict self-promotion; the winning move is **being genuinely helpful in existing threads** ("best AI tools for literature review?" style posts appear weekly).

- Set a saved-search or weekly scan for "Obsidian", "AI notes", "literature review tool" in both subs.
- Reply with the actual method (no link-dropping in the first sentence): "I chat with my literature notes directly in Obsidian — @-mention the paper's note, ask for the argument, run it on a free local model so it costs nothing."
- Include the link only when the sub rules allow, or say "the plugin is in my post history."
- Budget: 30 minutes, Tue 20 Oct and once weekly after.

### 5.7 Hacker News — Show HN (full example)

> **Title:** Show HN: Curtis AI – local-first AI chat for Obsidian (41 providers, agent + MCP)
>
> First comment (the HN convention):
>
> Hi HN, I built Curtis AI because I wanted AI chat inside my note vault without a cloud service of mine in the middle.
>
> It's an Obsidian plugin (TypeScript, MIT): chat sidebar, and — opt-in — an agent with 11 tools to read/search/create/edit notes, plus MCP server support. There's an arena mode that streams one prompt to 2–4 models in parallel and lets you promote the winner, and memory that proposes facts and only persists them after you approve, with provenance back to the conversation.
>
> Architecture-wise: BYOK across 41 providers or fully local via Ollama/LM Studio; keys go in the OS keychain; every conversation is a markdown file in the vault, so sync and search are Obsidian's problem, not mine. No telemetry, no server of mine.
>
> Hard problems I'd enjoy discussing: type-guard narrowing at every provider JSON boundary (41 response shapes), tool-permission ceilings for agents, and keeping memory capture opt-in without making it annoying.
>
> Repo: <link>

**Steps:** Mon 26 Oct, 8–8:30am ET (avoid top-of-hour). Expect the "why a plugin instead of a standalone app" and "Electron" threads — answer honestly, engage with technical criticism, do not defend, explain.

### 5.8 X/Twitter thread — skeleton

Six posts, one idea per post, GIF on post 1:

1. Hook: "I gave an AI agent read/write access to my Obsidian vault — with permission ceilings, and a memory that asks before it remembers anything. Here's what happened. (free, MIT, thread)"
2. Arena demo GIF: "One prompt, streamed to 4 models at once. Stop the losers. Promote the winner."
3. Memory GIF: "Proposed facts, Save/Skip per fact, provenance back to the conversation. The AI that asks permission."
4. "41 providers. Or fully local on Ollama — nothing leaves the machine. Keys in the OS keychain."
5. Agent + MCP: "The agent has 11 vault tools and can inherit anything from your MCP servers. Named agents = roles with tool ceilings (an Editor that can read but never write)."
6. "Free and open source. Repo + 60-second Ollama quick start: <link>"

Post Thu 22 Oct, 9am ET. Engage with every reply that day. Quote-tweet the HN thread on the 27th if it got traction.

### 5.9 Creator outreach — email/DM template

**Targets (in order):** PKM/Obsidian YouTubers (e.g. Nicole van der Hoeven, Zsolt Viczian, TfTHacker), note-app reviewers (Keep Productive), LYT/Linking Your Thinking community, Obsidian Roundup (see §5.10), plus 1–2 TTRPG channels from the Obsidian TTRPG community.

> **Subject:** Obsidian plugin you might like to poke at — Curtis AI (free, MIT, BYOK)
>
> Hi <name> — I wrote Curtis AI, an open-source Obsidian plugin: AI chat with an agent that can read/edit vault notes (permission-capped), a multi-model arena, and memory that asks before saving. 41 providers or fully local via Ollama.
>
> I'm not pitching a sponsorship — just wondering if it's interesting enough for you to poke at. If it sparks a video/post idea, great; if not, any blunt feedback on the settings funnel would genuinely help.
>
> Repo: <link>. Happy to do a walkthrough call or answer anything async.
>
> — Jordan

**Rules:** personalize the first line per person (reference their actual content), send Tue 27 Oct, one polite follow-up after 5 days, zero pressure, and never ask for a positive review — ask for a look.

### 5.10 Newsletter pitch — Obsidian Roundup et al.

Community newsletters want a copy-paste blurb with a link. Send:

> Hi — item for the next roundup if useful: **Curtis AI v2.0** — free/OSS AI chat for Obsidian: agent mode with vault tools + MCP servers, multi-model arena, memory with per-fact approval and provenance, BYOK across 41 providers or fully local (Ollama). <link>. Blurb you can trim: "Polyglot AI chat plugin — agent with vault tools, model arena, local-first."

---

## 6. Pre-flight asset checklist (Weekend of Oct 10–11)

- [ ] Directory submission PR filed (§7) — **do this first, review takes the longest**
- [ ] Arena GIF + memory GIF exported at Reddit-friendly sizes; uploaded to Reddit's native uploader as drafts
- [ ] 2–3 fresh screenshots (desktop agent conversation, settings provider pane, phone framed)
- [ ] README first 100 words re-read as a stranger: does it say what/who/why within one screen?
- [ ] versions.json + manifest.json agree; release assets present for the current version (marketplace credibility rule — installs have broken before when they didn't)
- [ ] GitHub Discussions enabled with an "ideas" category; issue templates in place
- [ ] All post drafts written (§5) and parked in a drafts folder
- [ ] Tracking: bookmark the plugin's obsidianstats.com page; GitHub stars = 1 glance per day, no more

Optional but high-value: record one 3–5 minute lo-fi YouTube demo ("Curtis AI in 4 minutes — local AI over your notes") to upload Nov 3. Screen recording + voice, no editing polish needed; this community trusts lo-fi.

---

## 7. Official community plugin directory — step-by-step

This is the biggest distribution unlock (in-app store = the installs that never read Reddit). Do it in week 0 because review takes days–weeks.

1. Re-check your plugin against Obsidian's developer policy and plugin guidelines (manifest completeness, no `eval`, no network calls beyond disclosed ones, `minAppVersion` truthful — 1.13.0 per the settings API).
2. Verify `manifest.json` and `versions.json` agree for 2.0.0 and every prior release (the repo has `npm run version` for this — never hand-edit one).
3. Fork `obsidianmd/obsidian-releases`, add to `community-plugins.json`:
   ```json
   {
       "id": "curtis-ai-chat",
       "name": "Curtis AI",
       "author": "JordanNewell",
       "description": "Polyglot AI chat: 30+ providers, agent mode with vault tools + MCP servers, multi-model arena, voice I/O, long-term memory. Local-first (Ollama/LM Studio). Free, MIT.",
       "repo": "JordanNewell/curtis-ai-chat"
   }
   ```
4. Open the PR using their PR template; the validation bot will comment — fix anything it flags and re-push (don't open a new PR).
5. While waiting: BRAT stays the install path for early users; every post's CTA remains the repo.
6. On merge: update the pinned Reddit/forum comments, README quick-start (store install becomes step 1), and the site. That's a second mini-launch — announce "now in the community plugin store" as its own short post in r/ObsidianMD and the forum thread.

---

## 8. Rules of engagement

1. **Disclose authorship, always.** "I'm the developer" in post 1. This community rewards it and detects its absence.
2. **Never punch at Copilot / Smart Connections.** They proved the category. Generous comparisons read as confidence.
3. **One launch post per subreddit.** Follow-ups must be materially different content (a workflow story, a numbers post) and spaced 2+ weeks.
4. **9:1 rule.** For every self-interested post, participate in nine unrelated threads helpfully. Weeks 1–4: budget 20 min/day for this.
5. **Answer every comment within the hour on launch day, within 48h after.** Slow dev replies kill plugin launches more surely than bad features.
6. **Voice: terse, technical, honest, no emoji** in anything official (matches the repo's own copy standard). Enthusiasm is fine; hype words ("revolutionary", "game-changer") are not.
7. **No engagement tricks.** No alt accounts, no vote coordination, no cross-posting identical text. The Obsidian community is small enough that it gets noticed, and it's unrecoverable.
8. **Log every question asked** in `research/marketing-QA-log.md` — launch comment threads are free user research and FAQ drafts.

---

## 9. Metrics and weekly retro (Fridays 16/23/30 Oct, 6 Nov)

Check four numbers, in this order, and write three sentences against each week's hypothesis:

| Metric | Source | Week-over-week question |
|---|---|---|
| Weekly downloads | obsidianstats.com plugin page | Did the week's post move installs? (Reddit spikes show within 48h) |
| Stars | GitHub | Velocity, not total |
| Referrals | GitHub traffic insights (views/clones) | Which day spiked, and what did we post that day? |
| Threads/mentions | GitHub Discussions + search "curtis-ai-chat" | Is anyone using it without us asking? |

**Decision rule at the end of week 4:** double down on whichever pillar+segment produced the most downloads-per-post (historically for this category it's the dev/local segment on r/LocalLLaMA and the power-user segment on r/ObsidianMD), kill the losers, and plan weeks 5–8 as: monthly workflow posts, weekly comment-seeding, creator content as it lands, and the store-launch mini-blitz when the directory PR merges.

**Nov 5 — "30 days of Curtis" transparency post:** real numbers, what worked, what didn't, next priorities. Post on the forum thread + GitHub Discussions + X. Transparency posts are the cheapest credibility you will ever buy in this community, and they seed the next launch.

---

## 10. Budget

- **$0 (default):** everything above. This plan works at $0.
- **~$300–500 (optional, week 3+):** one mid-size PKM or TTRPG YouTuber sponsorship, or a sponsored slot in a note-taking newsletter. Only after the retro shows which segment converts — never before you know who's buying.
