# Voice I/O

> Talk to Curtis. Listen to Curtis. Hands-free.

Two voice features shipped in v4.0.0:

- **Speech-to-text (STT)** — click the mic button, talk, transcribed text lands in the chat input. Powered by OpenAI Whisper.
- **Text-to-speech (TTS)** — click the speaker button on any assistant message to hear it read aloud. Uses your browser's built-in `speechSynthesis`. No API key required.

## Speech-to-text (Whisper)

### Requirements

- An **OpenAI API key** configured under Settings → Provider Configuration → OpenAI
- A browser/Electron environment with `MediaRecorder` support (all desktop Obsidian, most modern mobile)

### How to use

1. Click the **microphone icon** 🎙️ next to the chat input
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

## Text-to-speech (browser synthesis)

### Requirements

None. `speechSynthesis` is built into every modern browser and Electron.

### How to use

- **One message** — hover any assistant message and click the **speaker icon** 🔊
- **Auto-speak** — click the **auto-speak toggle** in the chat header. Every new assistant response is read aloud automatically. Toggle off to stop.

### Voice selection

The plugin picks a voice in this order:

1. The default `en-US` voice, if one exists
2. Any English-language voice
3. The first available voice

There's no UI to pick a specific voice yet. If you want a different voice, the browser's `speechSynthesis.getVoices()` list is the source — a settings picker is on the roadmap.

### Markdown handling

Before synthesis, the plugin strips markdown so the voice reads naturally instead of reciting punctuation:

- Code fences (` ```...``` `) become "code block"
- Inline code (`` `code` ``) is read as-is without backticks
- Bold/italic markers (`**`, `*`) are stripped
- Markdown links `[text](url)` become just the link text
- Headings (`#`) and list markers (`-`, `*`) are stripped
- Image syntax (`![alt](url)`) is removed entirely

## Privacy

| Path | Where it goes | API key needed |
|---|---|---|
| **STT (recording → text)** | OpenAI Whisper API | Yes (OpenAI) |
| **TTS (text → speech)** | Local browser engine | No |

> [!WARNING]
> **STT sends your audio to OpenAI.** The recording is uploaded to `api.openai.com` for transcription. Don't dictate sensitive content you wouldn't put in a chat message. TTS is fully local — no text leaves your machine.

For fully private voice, there's no in-plugin local Whisper integration yet. Run [whisper.cpp](https://github.com/ggerganov/whisper.cpp) locally and configure a custom OpenAI-compatible STT endpoint when v4.1.0 adds that setting.

## Mobile considerations

- **`MediaRecorder` support varies** on older Android WebViews. If the mic button doesn't respond, your device may not support it. iOS 16+ and modern Android are fine.
- **`speechSynthesis` quality varies** — mobile voices are often lower-quality than desktop. Auto-speak can also be cut off by mobile background-process limits; keep Obsidian in the foreground while listening.
- **Mic permission** — iOS Safari-based WebViews require explicit per-app permission. If granted once, it persists.

## Roadmap

- **Streaming TTS** — begin speaking before the full response arrives, for lower perceived latency
- **Wake-word** — "Hey Curtis" hands-free activation
- **Custom voice picker** — choose from `speechSynthesis.getVoices()`
- **Local Whisper** — whisper.cpp / faster-whisper integration for offline STT
- **Custom STT endpoint** — point at a self-hosted Whisper server
- **Per-conversation auto-speak** — auto-speak toggle that remembers per conversation
