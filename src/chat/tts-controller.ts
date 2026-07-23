// TTS playback controller — wraps window.speechSynthesis with sentence-level
// chunking so we can support pause/resume, skip ±1 sentence, and rate change.
//
// The Web Speech API has no native seek. To get skip/seek semantics we split
// the text into sentence-sized utterances and play them sequentially. State
// (currentSentence, rate, isPlaying, isPaused) is published to subscribers,
// which render the player UI.

import { cleanTextForSpeech } from './voice';

export interface TTSState {
	isPlaying: boolean;
	isPaused: boolean;
	currentSentence: number;
	totalSentences: number;
	rate: number;
}

export type TTSListener = (state: TTSState) => void;

const RATE_STEPS = [1, 1.25, 1.5, 1.75, 2];

/** Split clean text into sentence chunks. Each chunk becomes one utterance. */
function splitIntoSentences(text: string): string[] {
	// Split on . ! ? followed by whitespace or end, preserving the punctuation.
	const parts = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [text];
	return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

export class TTSController {
	private state: TTSState = {
		isPlaying: false,
		isPaused: false,
		currentSentence: 0,
		totalSentences: 0,
		rate: 1,
	};
	private sentences: string[] = [];
	private listeners: Set<TTSListener> = new Set();
	private voice: SpeechSynthesisVoice | null = null;

	constructor() {
		// Cache a preferred voice once. Subsequent utterances reuse it so
		// there's no voice drift between sentences.
		const voices = window.speechSynthesis.getVoices();
		this.voice =
			voices.find((v) => v.lang === 'en-US' && v.default) ||
			voices.find((v) => v.lang.startsWith('en')) ||
			voices[0] ||
			null;
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

	/** Start playing a fresh text. Resets rate + position. */
	play(text: string): void {
		const clean = cleanTextForSpeech(text);
		this.sentences = splitIntoSentences(clean);
		this.state = {
			isPlaying: true,
			isPaused: false,
			currentSentence: 0,
			totalSentences: this.sentences.length,
			rate: 1,
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

		// Cancel anything still queued so rapid skips don't pile up.
		window.speechSynthesis.cancel();

		const utterance = new SpeechSynthesisUtterance(this.sentences[idx]);
		utterance.rate = this.state.rate;
		utterance.pitch = 1;
		utterance.volume = 1;
		if (this.voice) utterance.voice = this.voice;

		utterance.onend = () => {
			// If the user paused/stopped during this utterance, don't advance.
			if (!this.state.isPlaying || this.state.isPaused) return;
			if (this.state.currentSentence === idx) {
				this.speakSentence(idx + 1);
			}
		};
		utterance.onerror = () => {
			if (!this.state.isPlaying) return;
			this.state.isPlaying = false;
			this.notify();
		};

		window.speechSynthesis.speak(utterance);
		this.notify();
	}

	pause(): void {
		if (!this.state.isPlaying || this.state.isPaused) return;
		window.speechSynthesis.pause();
		this.state.isPaused = true;
		this.notify();
	}

	resume(): void {
		if (!this.state.isPaused) return;
		window.speechSynthesis.resume();
		this.state.isPaused = false;
		this.notify();
	}

	stop(): void {
		window.speechSynthesis.cancel();
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
