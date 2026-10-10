# Wake-Word Ambient Voice — Approach & Implementation Plan

> **Status:** APPROVED-APPROACH (pending review). Phase 1 plan is buildable as written.
> **Supersedes:** the VOICE.md note "wake-word pending native KWS" — we now have a concrete engine choice.
> **Layers on:** `feat/ambient-voice-memory` (hotkey ambient capture, v4.1.0). Wake-word replaces the *trigger only*; everything downstream (Whisper → distill → `memoryStore.addFact`) is reused unchanged.

---

## 1. Decision (ADR)

**Engine: openWakeWord compiled to WASM, run in-plugin via onnxruntime-web.**

| Option | License | Local? | "Hey Curtis" | Fit in Obsidian plugin | Verdict |
|---|---|---|---|---|---|
| **openWakeWord (WASM)** | MIT | 100% on-device | Custom-trained model (community tooling) | Proven browser path: onnxruntime-web + AudioWorklet; models 1–10 MB; ~few % CPU | ✅ **chosen** |
| Picovoice Porcupine | Proprietary (free tier: AccessKey + attribution + monthly activation limits) | Yes, but AccessKey phones home to Picovoice licensing | Custom keyword via Picovoice Console | WASM exists, but license terms are hostile to an open-source plugin and require a per-user AccessKey | ❌ |
| sherpa-onnx KWS | Apache-2.0 | 100% | Supports custom keywords | Heavier runtime, no first-class JS/WASM plugin packaging; more integration surface than we need | ❌ (revisit only if openWakeWord accuracy disappoints) |
| Cloud KWS (Picovoice/Cobalt SaaS) | varies | No | Yes | Adds network dependency + privacy regression for an always-on mic | ❌ hard no (privacy) |

**Key precedent:** openWakeWord-in-browser is a solved problem — `onnxruntime-web` loads the ONNX models directly; public demos (Deep Core Labs, `openwakeword_wasm`) run real-time KWS with no native layer. We replicate that pipeline inside the Obsidian Electron/WebView environment.

## 2. Constraints (what "always-on" can and cannot mean here)

1. **Plugin sandbox:** Obsidian plugins can't register OS-global hotkeys or keep the mic open when Obsidian is unfocused/minimized. Wake-word therefore works **while Obsidian has focus** (desktop). This is the honest limit stated in VOICE.md and we keep stating it.
2. **Mobile:** getUserMedia + WASM works on modern iOS/Android WebViews, but background audio is routinely killed. Ship wake-word as **desktop-only initially**; mobile keeps the existing hotkey trigger.
3. **Privacy:** the wake-word stream is **never uploaded**. Audio leaves the machine only after the trigger fires, via the existing Whisper path the user already opted into. Model download happens once at enable-time (bundled asset preferred — see Phase 1).
4. **Latency budget:** trigger → recording start must feel instant. openWakeWord at 16 kHz frames has ~200–400 ms end-to-end detection latency; silence-timeout machinery already covers the tail. No new latency added downstream.
5. **False-positive discipline:** an always-open mic that spurious-fires into Whisper costs money and trust. Require (a) a tunable detection threshold (default conservative), (b) refractory period (default 5 s), (c) a distinct audible/visual cue on trigger, (d) a "snooze" ribbon to pause detection for N minutes.

## 3. Architecture

```
┌─ AudioWorklet (128-sample frames @ ctx rate) ─▶ resample → 16 kHz ring buffer
│                                                            │
│                                              openWakeWord ONNX (onnxruntime-web, WASM)
│                                                            │ "hey_curtis" score > threshold
└────────────────────────────────────────────────────────────┘
                                                             ▼
                                   ambient-voice.ts start()  (unchanged capture pipeline)
```

- New module `src/chat/wake-word.ts`: `WakeWordDetector` class owning AudioContext, worklet, ring buffer, ONNX session, threshold/refractory logic. Emits one event: `triggered`.
- `ambient-voice.ts` gains a trigger source: hotkey (existing) OR detector event. One-line integration point.
- Settings: `enableWakeWord` (off by default — an always-open mic must be opt-in), `wakeWordThreshold`, `wakeWordRefractoryMs`, status indicator toggle.
- Ribbon icon (eye/mic slash) shows detection state: off / armed / triggered / snoozed.
- Model asset: bundle `hey_curtis` ONNX (~2–5 MB) under plugin assets at build time. Fallback first release: bundled community model (`hey_jarvis`-class) with custom "Hey Curtis" model as fast-follow via openWakeWord's training tooling.

## 4. Phases

**Phase 1 — Detector + integration (this plan, buildable now):** `wake-word.ts`, settings, ribbon status, wire to `ambient-voice.ts`, desktop-only guard, docs update. Acceptance: with Obsidian focused, saying the wake word starts a capture with no keypress; false-positive rate tolerable over a 30-min work session; CPU overhead < 5% of one core.

**Phase 2 — Custom "Hey Curtis" model:** train via openWakeWord training pipeline, bundle model, threshold calibration against real speech samples.

**Phase 3 — Streaming TTS (separate roadmap item, not this task):** speak before full response; independent of wake-word.

## 5. Risks

- **onnxruntime-web in Obsidian's CSP:** Electron renderer should allow `asm.js`/WASM from plugin resources; if the WebView blocks it, fall back to loading via `resourceUrl` blob. Mitigation: Phase 1 task 1 is a spike that proves model load + inference before any UI work.
- **Asset size:** models + ORT WASM runtime add ~10–15 MB to the plugin package. Acceptable for desktop; another reason mobile waits.
- **Accuracy of off-the-shelf model for "Hey Curtis":** Phase 1 may ship with a placeholder phrase if the custom model isn't trained yet; the trigger contract is model-agnostic.

## 6. Task breakdown (Phase 1)

1. **Spike:** load onnxruntime-web + an openWakeWord model in the plugin; verify inference from a mic stream in Obsidian desktop. Exit: log line shows per-frame scores. (Cameron's lane — WASM/runtime internals.)
2. **`WakeWordDetector` module** with AudioWorklet capture, resampler, threshold + refractory, `triggered` event. Unit-testable with injected score callbacks. (Cameron.)
3. **Settings + ribbon UI + status indicator** — enable toggle, threshold slider, snooze. (Kate.)
4. **Integration:** detector event → `ambientVoiceCapture.start()`; desktop-only guard; graceful no-op when OpenAI key absent (existing notices cover it). (Angela.)
5. **Docs:** update VOICE.md roadmap + MEMORY.md reference, this plan moves to archive. (Ada.)

Estimated: 1 spike (timeboxed 2 h) + ~3 focused build sessions across Angela/Cameron/Kate.
