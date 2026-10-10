# Voice I/O

> Talk to Curtis. Listen to Curtis. Hands-free.

Two voice features:

- **Speech-to-text (STT)** — click the mic button, talk, transcribed text lands in the chat input. Powered by OpenAI Whisper.
- **Text-to-speech (TTS)** — click the speaker button on any assistant message to hear it read aloud through a sentence player with karaoke highlighting. Uses your browser's built-in speech synthesis. No API key required.

Voice settings live in **Settings → Curtis AI → Voice** and persist across restarts: auto-speak, the read-aloud voice, the default rate, and sentence highlighting.

## Speech-to-text (Whisper)

### Requirements

- An **OpenAI API key** configured under Settings → Curtis AI → Provider Configuration (the OpenAI card must be enabled)
- A browser/Electron environment with `MediaRecorder` support (all desktop Obsidian, most modern mobile)

### How to use

1. Click the **microphone icon** 🎙️ in the composer row
2. Obsidian may prompt for microphone permission — allow it
3. Speak your message
4. Click the mic icon again (or the stop button) to end recording
5. Whisper transcribes the audio and the text appears in the chat input
6. Edit if needed, then send as normal

### Technical details

- Audio is captured via `MediaRecorder` with a codec preference of `audio/webm;codecs=opus`, falling back to `audio/webm`, `audio/ogg;codecs=opus`, or `audio/mp4` based on what the platform supports
- The audio blob is POSTed to `https://api.openai.com/v1/audio/transcriptions` as `multipart/form-data`
- Default model is `whisper-1`
- Uses raw `fetch()` rather than Obsidian's `requestUrl` because the Whisper API requires `multipart/form-data` bodies, which `requestUrl` doesn't support

There is no custom STT endpoint or model setting yet — the endpoint and model are fixed for now (see Roadmap).

## Text-to-speech (system voices)

### Requirements

None. `speechSynthesis` is built into every modern browser and Electron.

### How to use

- **One message** — hover any assistant message and click the **speaker icon** 🔊
- **Auto-speak** — toggle it in the composer row or under Settings → Voice. Every new assistant response is read aloud automatically, and the toggle survives restarts. Auto-speak speaks the whole message in one pass (no player bar, no highlighting).

### Settings → Voice

| Setting | What it does |
|---|---|
| **Auto-speak responses** | Speak each assistant response as it completes. The same toggle lives in the composer row. |
| **Read-aloud voice** | Pick a specific system voice from a dropdown of everything the OS reports. "System default (auto)" lets Curtis pick. Voices load asynchronously on some platforms — the list fills in when the OS delivers it. |
| **Read-aloud rate** | Default speaking speed, 0.5×–2×. The player's rate button overrides it for the current playback only. |
| **Highlight spoken sentence** | Karaoke follow-along (below). |

A voice stored on one machine that doesn't exist on another (voices are platform-specific) simply falls back to auto — no error, and the settings dropdown shows "System default (auto)".

### Player controls

Clicking the speaker icon opens an inline **TTS player bar** below the assistant message. The plugin splits the message into sentences and plays each one as a separate utterance, which gives you seek-style controls the browser's native `speechSynthesis` doesn't provide on its own.

The player has these controls, left to right:

| Control | What it does |
|---|---|
| **▶ / ⏸** | Pause or resume playback |
| **⏪** | Skip back one sentence |
| **⏩** | Skip forward one sentence |
| **`n / N`** | Position indicator (current sentence / total) |
| **`1x`** | Cycle playback speed. Steps through `1 → 1.25 → 1.5 → 1.75 → 2 → 1`. This is a session-level override on top of the configured default rate — it does not rewrite the setting. |
| **×** | Stop playback and close the player |

Playback starts at your configured rate (not forced back to 1×), and changing rate re-speaks the current sentence so the change is immediate.

While the player is open:

- The speaker icon on the message stays highlighted, indicating active audio.
- Only one TTS session can run at a time. Starting playback on another message stops the first.
- Closing the player or starting a new send tears down the controller and cancels any queued utterances.

### Karaoke highlight

With **Highlight spoken sentence** on, the sentence being read is highlighted in the message and scrolled into view, so you can read along or jump around by eye. The highlight marks live exactly where the sentence text is, so the highlight and the audio can't drift apart. Turn the setting off and no highlight markup is created at all.

### What gets spoken

Sentences are taken from the **rendered message** — the text you see on screen. That means code blocks, tables, and UI chrome (buttons, action bars, the player itself) are silently skipped rather than read aloud.

When there's no rendered DOM to walk (programmatic playback), the message content is cleaned instead: markdown is stripped so the voice reads naturally instead of reciting punctuation.

- Code fences (` ```...``` `) become "code block"
- Inline code (`` `code` ``) is read as-is without backticks
- Bold/italic markers (`**`, `*`) are stripped
- Markdown links `[text](url)` become just the link text
- Headings (`#`) and list markers (`-`, `*`) are stripped
- Image syntax (`![alt](url)`) is removed entirely

Sentence boundaries are decided by a regex split on `.`, `!`, `?` followed by whitespace. Abbreviations and decimal numbers can throw this off — you'll occasionally hear a sentence broken mid-thought. Skipping forward is the fastest recovery.

## Privacy

| Path | Where it goes | API key needed |
|---|---|---|
| **STT (recording → text)** | OpenAI Whisper API | Yes (OpenAI) |
| **TTS (text → speech)** | Local browser engine | No |

> [!WARNING]
> **STT sends your audio to OpenAI.** The recording is uploaded to `api.openai.com` for transcription. Don't dictate sensitive content you wouldn't put in a chat message. TTS is fully local — no text ever leaves your machine.

## Mobile considerations

- **`MediaRecorder` support varies** on older Android WebViews. If the mic button doesn't respond, your device may not support it. iOS 16+ and modern Android are fine.
- **`speechSynthesis` quality varies** — mobile voices are often lower-quality than desktop. Auto-speak can also be cut off by mobile background-process limits; keep Obsidian in the foreground while listening.
- **Mic permission** — iOS Safari-based WebViews require explicit per-app permission. If granted once, it persists.

## Roadmap

The player now sits on a pluggable backend seam (`TTSBackend`) that non-local engines can implement — the architecture is ready for:

- **Neural TTS** — OpenAI's speech API on the key you already have, and a fully local/offline neural voice; both behind the existing backend interface, same player, same controls
- **Custom STT endpoint** — point dictation at Groq or a self-hosted Whisper server instead of OpenAI
- **Streaming TTS** — begin speaking before the full response arrives, for lower perceived latency
- **Wake-word** — "Hey Curtis" hands-free activation

None of these are in the current release; the shipped TTS is entirely local system-voice synthesis.
