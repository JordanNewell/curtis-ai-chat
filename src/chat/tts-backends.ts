// TTS backends — the playback seam behind the sentence player.
//
// TTSController owns sentence sequencing and state; a backend speaks one
// sentence chunk at a time and knows nothing about ordering. Native wraps
// the Web Speech API; neural engines (OpenAI /v1/audio/speech, local
// Kokoro) implement the same interface over Audio elements.
//
// The seam also keeps the controller Obsidian-free and unit-testable: tests
// drive a fake backend instead of window.speechSynthesis.

import { isSpeechSupported, pickSpeechVoice } from './voice';

export interface SpeakChunkOptions {
	rate: number;
	pitch: number;
	/** Fired when the chunk finished playing. */
	onEnd: () => void;
	/** Fired when the chunk failed to play. */
	onError: () => void;
}

export interface TTSBackend {
	/** Speak one sentence chunk. Backends cancel any in-flight speech
	 *  first, so rapid skips never pile up queued audio. */
	speak(chunk: string, opts: SpeakChunkOptions): void;
	cancel(): void;
	pause(): void;
	resume(): void;
}

/** System voices via the Web Speech API (window.speechSynthesis). */
export class NativeSpeechBackend implements TTSBackend {
	private voiceResolved = false;
	private voice: SpeechSynthesisVoice | null = null;

	constructor(private voiceUri: string) {
		// Voices load asynchronously in many windows (getVoices() returns []
		// until voiceschanged fires) — resolve lazily instead of caching once,
		// and re-resolve when the voice list arrives.
		if (isSpeechSupported()) {
			window.speechSynthesis.onvoiceschanged = () => {
				this.voiceResolved = false;
			};
		}
	}

	speak(chunk: string, opts: SpeakChunkOptions): void {
		// Cancel anything still queued so rapid skips don't pile up.
		window.speechSynthesis.cancel();

		const utterance = new SpeechSynthesisUtterance(chunk);
		utterance.rate = opts.rate;
		utterance.pitch = opts.pitch;
		utterance.volume = 1;
		const voice = this.pickVoice();
		if (voice) utterance.voice = voice;
		utterance.onend = opts.onEnd;
		utterance.onerror = opts.onError;
		window.speechSynthesis.speak(utterance);
	}

	cancel(): void {
		if (isSpeechSupported()) window.speechSynthesis.cancel();
	}

	pause(): void {
		if (isSpeechSupported()) window.speechSynthesis.pause();
	}

	resume(): void {
		if (isSpeechSupported()) window.speechSynthesis.resume();
	}

	private pickVoice(): SpeechSynthesisVoice | null {
		if (!this.voiceResolved) {
			this.voiceResolved = true;
			this.voice = pickSpeechVoice(this.voiceUri);
		}
		return this.voice;
	}
}
