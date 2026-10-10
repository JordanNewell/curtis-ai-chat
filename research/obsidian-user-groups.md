# Who uses Obsidian — user groups & marketing angles for Curtis AI

Research note, 2026-10-10. Sources listed at the bottom.

## Market snapshot

- Obsidian estimated **~1 million users** in 2023 (Fast Company interview), with a Discord of 110k+ members. Growth has continued; the plugin ecosystem is the reliable proxy for who the users are and what they want.
- The all-time most-downloaded community plugins (obsidianstats.com) are: Excalidraw, Templater, Dataview, Tasks, Advanced Tables, **Git**, Calendar, Style Settings, Kanban, Remotely Save, Iconize, **Claudian** (AI chat, ~2 months old and already top-15), QuickAdd, **Copilot** (AI chat), Editing Toolbar, Omnisearch, Minimal Theme, Importer, TaskNotes, Outliner, Homepage, **Smart Connections** (AI, 1.2M downloads), Recent Files, Tag Wrangler, Linter.
- Reading of that list: the audience is dominated by **power users who customize heavily**, a large **developer** contingent (Git at #6), a large **journaling/task** contingent (Calendar, Tasks, Kanban, TaskNotes), and **AI demand is already proven** — three AI chat plugins sit in the top 25 of all time. Curtis is entering a validated category, not creating one.

## Top user groups, ranked by relevance to Curtis AI

### 1. PKM power users ("second brain" builders) — the core audience
Zettelkasten / PARA / MOC system builders. Evidence: Templater (#2), Dataview (#3), QuickAdd (#13) all top-15 all-time.
- **Pitch:** an AI that operates *inside* the system they built — agent reads/writes vault notes, @-mention any note as context, conversations persist as ordinary markdown files.
- **Hook to lead with:** memory with ask-before-save and provenance. This group distrusts silent data mutation; Curtis is the AI that asks permission.

### 2. Developers & technical users — loudest and most influential
Evidence: Git plugin #6 all-time, Omnisearch, BRAT installs, Templater scripting. They are also the ones running Ollama and MCP servers, and the ones writing the Reddit/forum posts that drive adoption for everyone else.
- **Pitch:** BYOK across 41 providers, MCP server support, agent tool-calls, keys in the OS keychain, Ollama for local/offline.
- **Hook:** "your vault is a codebase — give your agent read/write access with ceilings you control."

### 3. Students & academics / researchers
Evidence: effortlessacademic.com literally teaches "chat with your notes" via Copilot/Smart Connections; academic workflow posts on the forum; Excalidraw (#1) is the study/sketch tool; Outliner's own blurb addresses "students, researchers."
- **Pitch:** @-mention your literature notes, semantic search across the vault, /recap at the end of a study session.
- **Hook:** price sensitivity is real — "run it on a free/local model" (Ollama, free tiers) is a genuine differentiator for this group. The arena also sells itself: "compare two models' explanations side by side."

### 4. Writers — novelists, bloggers, journalists, newsletter/YouTube creators
Evidence: MacStories ("no matter what your writing needs are, there's probably a plug-in"); second-brain-for-writing posts (Thesis Whisperer).
- **Pitch:** inline autocomplete ghost text, Cursor-style diff rewrite with Accept/Reject, editor/researcher named agents with read-only tool ceilings, voice dictation + TTS read-back for proofing.
- **Hook:** "edit in place, accept or reject the diff" — writers fear AI overwriting their prose; the Accept/Reject modal is the trust feature.

### 5. Daily journalers, planners & task managers — biggest volume segment
Evidence: Calendar (#7), Tasks (#4), Kanban (#9), TaskNotes (#19), daily-notes polls on the forum.
- **Pitch:** /recap writes a session summary into an append-only journal note; memory persists context across days; agent can create notes in your daily-note structure.
- **Hook:** "your AI remembers yesterday" — the memory chip plus journal integration is the demo that lands here.

### 6. Privacy-first professionals — lawyers, therapists, doctors, consultants
Evidence: forum threads on therapy notes ("a safe, locally-stored place for my counseling/therapy notes") and lawyers summarizing case law. Small segment, but it's *why they chose Obsidian over Notion*, and they're underserved and high-trust.
- **Pitch:** Ollama = nothing leaves the machine; conversations are local markdown; keys live in the OS keychain; memory-off agents never write to shared memory.
- **Hook:** "fully private, free, offline AI" (the README tip). Caution: for cloud models be precise about what leaves the vault — this group reads the docs.

### 7. TTRPG game masters & worldbuilders — surprisingly large, very vocal
Evidence: dedicated Obsidian TTRPG community (GitHub org), campaign-management writeups (Gnome Stew, GM Assistant).
- **Pitch:** the agent as a lore librarian — semantic search over the campaign vault ("what did I establish about this faction?"), named agents as in-world NPCs, local models for spoiler-sensitive prep.
- **Hook:** session-prep and lore-consistency demos; this community shares plugins aggressively in its own channels.

### 8. Migrators & multi-subscription AI users — conversion audience
Evidence: Importer (#18 all-time) shows constant inflow from Notion/Roam/Evernote/Apple Notes; Copilot's Plus tier shows users already paying for AI-in-Obsidian.
- **Pitch:** chat import from ChatGPT/Claude exports, `.curt` portable conversations, and the arena replacing the "which model is best" subscription shuffle — bring your own keys instead of three subscriptions.

## Where to reach them

- **r/ObsidianMD and forum.obsidian.md** — segments 1, 2, 5, 7 all live here; show a working demo GIF, no hype.
- **Obsidian Discord / subreddit plugin showcases** — release-day posts.
- **YouTube PKM/study creators** — segments 3 and 5 convert strongly from a single 5-minute setup video.
- **TTRPG Discord servers and the Obsidian TTRPG GitHub community** — segment 7, almost zero AI-plugin competition there.
- **Local-first / privacy communities** (r/LocalLLaMA, Ollama Discord) — segments 2 and 6; the Ollama angle is the wedge.

## One-line summary

Obsidian's base skews technical, privacy-conscious, and system-building; the AI-in-Obsidian category is already proven (Copilot, Smart Connections, Claudian all top-25). Market Curtis as **"the AI that stays in your vault and asks permission"**: agent + memory provenance for power users, BYOK/Ollama/MCP for developers, free-local-model angle for students, diff-rewrite trust for writers, and the arena for model-tinkerers.

## Sources

- [Obsidian's Popularity Explained — MacStories](https://www.macstories.net/stories/obsidians-popularity-explained/) (1M users estimate, Discord size, writing use case)
- [Most Downloaded Obsidian Plugins — Obsidian Stats](https://www.obsidianstats.com/most-downloaded) (plugin rankings, Claudian/Copilot/Smart Connections presence)
- [Smart Connections — Obsidian community plugins](https://community.obsidian.md/plugins) (1.2M downloads)
- [Copilot for Obsidian](https://www.obsidiancopilot.com) (BYOK positioning, agents)
- [Using Obsidian as a Therapist — Obsidian forum](https://forum.obsidian.md) and lawyer threads (privacy-driven professionals)
- [Obsidian TTRPG Hub](https://publish.obsidian.md) / [Campaign Management in Obsidian — Gnome Stew](https://gnomestew.com) / [GM Assistant](https://gmassistant.app) (TTRPG segment)
- [Adding AI to your Obsidian Notes — Effortless Academic](https://effortlessacademic.com) (academic chat-with-notes demand)
- [Building a second brain for writing — Thesis Whisperer](https://thesiswhisperer.com) (academic writers)
- [What Is Obsidian Used For? A Practical 2026 Guide — Obsibrain](https://www.obsibrain.com) (use-case overview)
