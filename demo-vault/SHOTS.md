# Shot List — Curtis AI Chat screenshots + video

Practical playbook for capturing every screenshot the launch needs, plus the video script for the demo video.

## Capture setup

**Window:** 1440×900 (MacBook Pro 14" default) or 1920×1080 (desktop). Pick one, stick to it for every shot.

**Theme:** Default Obsidian dark (already configured in `.obsidian/appearance.json`).

**Accent:** Curtis green `#34D399` (configured).

**Font:** 15pt body, JetBrains Mono for code (configured).

**Frame:** For most shots, show the file explorer (left), editor (center), Curtis chat (right). Hide left sidebar via `Cmd/Ctrl+P → Toggle sidebar` only for ultra-clean hero shots.

**Capture tool:** macOS Cmd+Shift+4 (drag); Windows Snipping Tool; or [CleanShot X](https://cleanshot.com/) for the pro grade (shadow + cursor control worth the cost).

**Naming:** Save as `01-hero.png`, `02-agent.png`, etc. into `demo-vault/screenshots/` (gitignored — local-only).

---

## Pre-flight (every session)

1. Confirm Ollama is running: `curl http://localhost:11434/api/tags`
2. If not: `ollama serve` in a terminal
3. Confirm the demo model is pulled: `ollama list` should show `qwen2.5:7b-instruct`
4. Open the demo vault in Obsidian
5. Open the Curtis chat sidebar: ribbon robot icon or `Ctrl+Shift+G`
6. `/clear` to start fresh
7. Default model in header dropdown: `qwen2.5:7b-instruct`

---

## Hero shots (the iconic images)

### 01 — Hero: chat sidebar in default state

**Purpose:** README hero, social share, OG fallback.

- Persona: **any** (use `02_pm` for variety)
- Active note: `02_pm/PRDs/q3-onboarding-overhaul.md`
- Action: open chat, no prompt sent yet. Default model visible in header.
- Composition: full window. File explorer visible (collapses some folders), PRD visible in editor, chat sidebar right with welcome state.
- Verify in frame: model dropdown shows `qwen2.5:7b-instruct`, agent icon visible, mic icon visible, slash-command hint visible.

### 02 — Hero: conversation in progress

**Purpose:** README secondary, Twitter card alt.

- Persona: `04_founder`
- Active note: `04_founder/Decisions/2026-07-01-pricing-flip.md`
- Prompt: *"Summarize the key risks in this decision in 3 bullets."* with the note @-mentioned via the active-note pill
- Composition: PRD visible left, 3-bullet AI summary visible in chat right. Capture AFTER AI finishes streaming.
- Verify in frame: AI response shows 3 bullets. Day separator visible above latest exchange.

---

## Feature shots (one per flagship feature)

### 03 — Curtis Agent: creating a note

**Purpose:** Agent feature showcase. README "agent" section, HN post.

- Persona: `02_pm` (Marcus Chen)
- Active note: `02_pm/Meetings/2026-07-18-engineering-sync.md`
- Agent enabled (already on by default per `data.json`)
- Prompt: *"Create a new note titled 'Onboarding overhaul action items' in 02_pm/PRDs/ with the action items from this meeting, organized by owner."*
- Composition: capture mid-tool-call — the tool-call indicator should be visible ("🔧 create_note..."), or capture right after the new note is created and Curtis confirms.
- Verify in frame: tool call indicator OR success message in chat; optionally show the new note in the file explorer.

### 04 — Curtis Agent: searching notes

- Persona: `01_researcher` (Elena)
- Active note: any
- Prompt: *"Search my notes for everything tagged 'reasoning' and tell me the most recent 3."*
- Composition: capture with search results visible in chat (tool result listing 3 paper notes from `Literature/`).
- Verify in frame: `search_notes` tool call visible; 3 file paths in the result.

### 05 — Multi-model arena

**Purpose:** Arena feature showcase. Standalone "wow" shot.

- Persona: `01_researcher` (compare model quality)
- Active note: `01_researcher/Literature/chain-of-thought-prompting.md`
- Click the **wand icon** in the chat header
- Pick 2 models: `qwen2.5:7b-instruct`, `qwen2.5:3b-instruct` (pull these via `ollama pull` first if missing)
- Prompt: *"What's the central critique of the 'emergent abilities' framing in this paper?"*
- Composition: 2 columns streaming. Capture MID-STREAM for the wow factor — different columns at different progress.
- Verify in frame: 2 model names visible as column headers, response text streaming in each.

### 06 — Inline diff rewrite

**Purpose:** Diff rewrite showcase. README feature section.

- Persona: `03_writer` (Priya)
- Active note: `03_writer/Drafts/client-post-ai-tools.md`
- Selection: highlight the opening paragraph ("I joined Hildegard as employee number eleven...")
- Trigger: `Ctrl+Shift+R` or right-click → "Rewrite with AI (diff)"
- Optional instruction: "tighten the opening"
- Composition: diff modal open, showing green/red lines side-by-side or inline.
- Verify in frame: green additions + red deletions clearly visible, Accept/Reject buttons at bottom.

### 07 — @-mention dropdown

**Purpose:** @-mention showcase.

- Persona: `02_pm`
- Active note: `02_pm/Customers/acme-renewal.md`
- Type `@` in the chat input
- Composition: dropdown open with fuzzy-search results showing meeting notes + PRDs. Optionally type `@q` to filter to the onboarding PRD.
- Verify in frame: dropdown list visible with file paths, highlighted selection, chips area above input empty.

### 08 — @-mention chips in message

- Persona: same as 07
- Attach the PRD via @-mention, then attach the meeting note
- Type a partial prompt but DON'T send yet
- Composition: 2 chips visible above the input showing the attached notes; prompt typed but unsent.
- Verify in frame: chips clearly visible, names readable.

### 09 — Voice I/O: mic active

- Persona: any (use `04_founder` for variety)
- Click the mic icon in the chat input
- Composition: capture WHILE the mic is recording — the waveform / recording indicator should be visible.
- Verify in frame: mic icon shows active state (usually red or pulsing), recording timer visible.
- Tip: 30 seconds of silence is fine — the goal is to show the recording state, not the transcript.

### 10 — Voice I/O: speaker on assistant message

- Send any prompt, get a response
- Hover over the assistant message — the speaker icon appears
- Click speaker — TTS starts
- Composition: assistant message with the speaker icon highlighted/active.
- Verify in frame: speaker icon visible and in "playing" state.

### 11 — Cross-conversation search

**Purpose:** Search feature showcase.

- Persona: `02_pm` (Marcus has the most staged conversations)
- Trigger: `Ctrl+Shift+F`
- Type: "acme" or "renewal"
- Composition: search picker modal open with results showing conversation snippets.
- Verify in frame: modal with results, search input populated, snippets readable.

### 12 — Memory panel (Settings → Memory)

**Purpose:** Memory feature showcase.

- Open Settings → Curtis AI Chat → Memory
- Composition: memory fact list visible (the pre-staged facts from `AI/Curtis Memory.md`).
- Verify in frame: 6-8 facts listed, edit/delete buttons visible per fact, "Add fact" button visible.
- Note: redact any facts you don't want public before screenshotting, or use the pre-staged facts verbatim.

### 13 — Slash command menu

- Type `/` in the chat input
- Composition: slash-command dropdown open showing all 16 commands.
- Verify in frame: commands listed with descriptions, `/export` and `/memory` visible.

### 14 — Image attached to message

- Persona: `01_researcher`
- Active note: any
- Drag any image into the chat input (or click paperclip)
- Composition: image preview thumbnail visible above input, ready to send.
- Tip: use a placeholder image — a screenshot of a chart from `01_researcher/Experiments/` works thematically.

### 15 — Markdown export

- After any conversation, type `/export` or click the download icon
- Composition: downloaded file open in a markdown viewer (could be VS Code preview) showing the conversation formatted as .md.

### 16 — Settings panel — provider config

**Purpose:** Settings UI shot. Useful for "polished UI" credibility.

- Open Settings → Curtis AI Chat → Provider Configuration
- Composition: provider list visible, Ollama shown as enabled, others disabled.
- Verify in frame: clean settings UI, no API keys visible (Ollama doesn't need one).

---

## Detail shots (optional variety)

### 17 — Active-note pill

- Open `02_pm/PRDs/q3-onboarding-overhaul.md`
- Composition: close-up of the chat header showing the active-note pill with the PRD title.
- Use: supporting visual for README or docs.

### 18 — Day separator

- Send 2 messages spaced a day apart (or manipulate system clock for the shot — quicker)
- Composition: close-up of the "Today" / "Yesterday" separator between messages.

### 19 — Hover toolbar on assistant message

- Send a message, get response, hover
- Composition: close-up of the hover toolbar showing copy/quote/save-as-note/regenerate/edit-resend.

### 20 — Mobile (phone screenshot)

- Optional. Open the demo vault on your phone (Obsidian mobile).
- Capture: chat sidebar on phone, single conversation, viewport-appropriate.
- Use: README mobile section, social posts.

---

## Video script — 90-second demo

**Format:** 90 seconds, single take or fast cuts, no narration over top needed if text overlays are strong. Aim for YouTube/Twitter native (16:9 + 1:1 variants).

**Setup before recording:**
- Window 1920×1080, fullscreen Obsidian
- Ollama running, all 3 demo models pulled
- `/clear` conversation
- Demo vault open at `02_pm/Inbox.md`

### Script

**0:00–0:05 — Title card**

Text overlay: "Curtis AI Chat. 30+ providers. One sidebar."

Background: the chat sidebar default state, slightly out of focus.

**0:05–0:15 — Open + first message**

Click robot icon. Chat opens. Type:

> "Summarize my inbox in 3 bullets."

Cut to response streaming. By 0:15, response is complete.

**0:15–0:25 — @-mention**

Type `@`, click `02_pm/Customers/acme-renewal.md`. Chip appears.

Continue prompt: *"What's the renewal risk for this account?"*

Cut to response. By 0:25, response complete.

**0:25–0:40 — Curtis Agent**

Type: *"Create a new note titled 'Acme renewal plan' in 02_pm/Customers/ with three action items based on what you just told me."*

Capture tool-call indicator, then success message. By 0:40, new note created.

**0:40–0:55 — Multi-model arena**

Click wand icon. Select 2 models: `qwen2.5:7b`, `qwen2.5:3b`.

Prompt: *"One sentence: what's the biggest risk in the Acme account?"*

Capture both columns streaming simultaneously. By 0:55, both responses complete.

**0:55–1:10 — Inline diff rewrite**

Open `03_writer/Drafts/the-last-train.md`. Select first paragraph. `Ctrl+Shift+R`.

Capture diff modal opening, green/red lines. Click Accept. By 1:10, edit applied.

**1:10–1:20 — Voice + memory**

Click mic icon. (Record anything — "what should I do next?" works.)

Cut to Settings → Memory. Show facts list.

**1:20–1:30 — Outro card**

Text overlay:

> "Curtis AI Chat. Free, open source, MIT.
> 30+ providers. Local-first via Ollama.
> jordannewell.com/products/curtis-ai-chat"

Background: hero screenshot or animated dot-grid.

### Production notes

- **Pacing:** each segment is ~10-15 seconds. That's the attention span per beat.
- **No audio needed** — text overlays carry the message. Optional music bed (royalty-free, low-key).
- **Cuts:** hard cuts work. No transitions.
- **Text overlays:** use Inter Tight Bold + JetBrains Mono for code/URLs. Match the brand colors.
- **Captions:** burn in for social. Auto-caption via Descript or Premiere if available.

### Distribution cuts

From the 90s master, cut:

- **60s Twitter/X** — drop the agent section (least essential in a feed-scroll context)
- **30s TikTok/Reels** — keep only: title → first message → arena → diff rewrite → outro
- **6s YouTube bumper** — title → arena streaming → outro

---

## After capture — asset management

1. Save all raws to `demo-vault/screenshots/` (gitignored — local only)
2. Crop + compress for web via [Squoosh](https://squoosh.app/) or ImageOptim
3. Final assets go to `docs/launch-playbooks/v1.0.0/screenshots/` (committed to repo)
4. Naming convention: `<feature>-<variant>.png` (e.g., `agent-create-note.png`, `arena-2-models.png`)
5. Update README hero image reference if a better hero emerges
6. Tweet thread: use 4 best screenshots as the album (per Twitter kit `50-twitter.md`)
