// TTS playback controller — sentence-level sequencing over a pluggable
// speech backend (see tts-backends.ts). The Web Speech API has no native
// seek, so sentences are played one utterance at a time; that is what
// gives us pause/resume, skip ±1 sentence, and rate change. State
// (currentSentence, rate, isPlaying, isPaused) is published to subscribers,
// which render the player UI (and, optionally, karaoke highlighting).

import type { TTSBackend } from './tts-backends';

export interface TTSConfig {
	/** voiceURI of the preferred system voice; '' = auto-pick. */
	voiceUri: string;
	/** Starting rate; the player's rate cycle overrides per session. */
	rate: number;
	pitch: number;
}

export interface TTSState {
	isPlaying: boolean;
	isPaused: boolean;
	currentSentence: number;
	totalSentences: number;
	rate: number;
}

export type TTSListener = (state: TTSState) => void;

const RATE_STEPS = [1, 1.25, 1.5, 1.75, 2];

export interface SentenceSpan {
	text: string;
	/** Offsets of the trimmed sentence in the source text. */
	start: number;
	end: number;
}

/** Split text into sentence spans with source offsets. Each span becomes
 *  one utterance; offsets let the chat view wrap the matching DOM text for
 *  karaoke highlighting. */
export function splitSentencesWithOffsets(text: string): SentenceSpan[] {
	const spans: SentenceSpan[] = [];
	const re = /[^.!?]+[.!?]+|\S[^.!?]*$/g;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		const raw = m[0];
		const trimmed = raw.trim();
		if (trimmed.length === 0) continue;
		const lead = raw.length - raw.trimStart().length;
		spans.push({ text: trimmed, start: m.index + lead, end: m.index + raw.length });
	}
	return spans;
}

/** Split clean text into sentence chunks. Each chunk becomes one utterance. */
export function splitIntoSentences(text: string): string[] {
	return splitSentencesWithOffsets(text).map((s) => s.text);
}

export class TTSController {
	private state: TTSState;
	private sentences: string[] = [];
	private listeners: Set<TTSListener> = new Set();
	/** Monotonic tag per utterance sent — stale onend/onerror events from
	 *  cancelled utterances (skip, rate change, stop) are ignored by comparing. */
	private generation = 0;

	constructor(
		private backend: TTSBackend,
		private config: TTSConfig
	) {
		this.state = {
			isPlaying: false,
			isPaused: false,
			currentSentence: 0,
			totalSentences: 0,
			rate: config.rate,
		};
	}

	subscribe(fn: TTSListener): () => void {
		this.listeners.add(fn);
		fn(this.state);
		return () => this.listeners.delete(fn);
	}

	getState(): TTSState {
		return { ...this.state };
	}

	private notify(): void {
		const snapshot = this.getState();
		for (const fn of this.listeners) fn(snapshot);
	}

	/** Start playing a pre-split sentence list — derived from the rendered
	 *  message DOM (so highlighting can't drift from what's on screen) or
	 *  from splitIntoSentences over cleaned content as a fallback. */
	play(sentences: string[]): void {
		this.sentences = sentences;
		this.state = {
			isPlaying: true,
			isPaused: false,
			currentSentence: 0,
			totalSentences: sentences.length,
			rate: this.config.rate,
		};
		this.speakSentence(0);
	}

	private speakSentence(idx: number): void {
		if (!this.state.isPlaying || idx >= this.sentences.length) {
			this.state.isPlaying = false;
			this.notify();
			return;
		}
		this.state.currentSentence = idx;

		const gen = ++this.generation;
		this.backend.speak(this.sentences[idx], {
			rate: this.state.rate,
			pitch: this.config.pitch,
			onEnd: () => {
				// Stale event from a cancelled/superseded utterance — the chain is
				// already being driven by a newer generation.
				if (gen !== this.generation) return;
				// If the user paused/stopped during this utterance, don't advance.
				if (!this.state.isPlaying || this.state.isPaused) return;
				this.speakSentence(idx + 1);
			},
			onError: () => {
				if (gen !== this.generation) return;
				if (!this.state.isPlaying) return;
				this.state.isPlaying = false;
				this.notify();
			},
		});
		this.notify();
	}

	pause(): void {
		if (!this.state.isPlaying || this.state.isPaused) return;
		this.backend.pause();
		this.state.isPaused = true;
		this.notify();
	}

	resume(): void {
		if (!this.state.isPaused) return;
		this.backend.resume();
		this.state.isPaused = false;
		this.notify();
	}

	stop(): void {
		this.generation++; // in-flight utterance events are stale from here on
		this.backend.cancel();
		this.state.isPlaying = false;
		this.state.isPaused = false;
		this.notify();
	}

	togglePauseResume(): void {
		if (this.state.isPaused) this.resume();
		else this.pause();
	}

	/** Skip to an absolute sentence index and play from there. */
	skipTo(idx: number): void {
		const clamped = Math.max(0, Math.min(this.sentences.length - 1, idx));
		this.state.isPaused = false;
		this.speakSentence(clamped);
	}

	skip(delta: number): void {
		this.skipTo(this.state.currentSentence + delta);
	}

	/** Cycle through [1, 1.25, 1.5, 1.75, 2] and back to 1. */
	cycleRate(): void {
		const idx = RATE_STEPS.indexOf(this.state.rate);
		const next = RATE_STEPS[(idx + 1) % RATE_STEPS.length];
		this.setRate(next);
	}

	setRate(rate: number): void {
		this.state.rate = rate;
		// Re-speak current sentence with new rate so the change is immediate.
		if (this.state.isPlaying) {
			this.speakSentence(this.state.currentSentence);
		} else {
			this.notify();
		}
	}
}
