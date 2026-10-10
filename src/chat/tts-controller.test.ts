// Unit tests for the TTS sentence player. tts-controller is Obsidian-free —
// playback is driven through the TTSBackend seam, so a fake backend stands
// in for window.speechSynthesis under node.

import { describe, expect, it } from 'vitest';
import { TTSController, splitIntoSentences, splitSentencesWithOffsets } from './tts-controller';
import type { SpeakChunkOptions, TTSBackend } from './tts-backends';

class FakeBackend implements TTSBackend {
	spoken: { chunk: string; opts: SpeakChunkOptions }[] = [];
	cancelled = 0;
	paused = false;

	speak(chunk: string, opts: SpeakChunkOptions): void {
		this.spoken.push({ chunk, opts });
	}

	/** Simulate the most recent utterance finishing naturally. */
	finish(): void {
		this.spoken[this.spoken.length - 1]?.opts.onEnd();
	}

	/** Simulate the most recent utterance failing. */
	fail(): void {
		this.spoken[this.spoken.length - 1]?.opts.onError();
	}

	cancel(): void {
		this.cancelled++;
	}

	pause(): void {
		this.paused = true;
	}

	resume(): void {
		this.paused = false;
	}
}

const makeController = (rate = 1): { controller: TTSController; backend: FakeBackend } => {
	const backend = new FakeBackend();
	const controller = new TTSController(backend, { voiceUri: '', rate, pitch: 1 });
	return { controller, backend };
};

describe('splitIntoSentences', () => {
	it('splits on terminal punctuation and keeps it', () => {
		expect(splitIntoSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
	});

	it('keeps a trailing fragment without punctuation', () => {
		expect(splitIntoSentences('First. and then some more')).toEqual(['First.', 'and then some more']);
	});

	it('returns nothing for empty or whitespace text', () => {
		expect(splitIntoSentences('')).toEqual([]);
		expect(splitIntoSentences('   \n  ')).toEqual([]);
	});

	it('drops whitespace-only chunks between punctuation', () => {
		expect(splitIntoSentences('A.  B. ')).toEqual(['A.', 'B.']);
	});
});

describe('splitSentencesWithOffsets', () => {
	it('reports offsets into the original text, trimmed bounds', () => {
		const text = '  Hello there. Bye!  ';
		const spans = splitSentencesWithOffsets(text);
		expect(spans.map((s) => s.text)).toEqual(['Hello there.', 'Bye!']);
		expect(text.slice(spans[0].start, spans[0].end)).toBe('Hello there.');
		expect(text.slice(spans[1].start, spans[1].end)).toBe('Bye!');
	});

	it('aligns with splitIntoSentences', () => {
		const text = 'One. Two! Three? Four';
		expect(splitSentencesWithOffsets(text).map((s) => s.text)).toEqual(splitIntoSentences(text));
	});
});

describe('TTSController', () => {
	it('plays the first sentence immediately and reports totals', () => {
		const { controller, backend } = makeController();
		controller.play(['A.', 'B.', 'C.']);
		const state = controller.getState();
		expect(state.isPlaying).toBe(true);
		expect(state.totalSentences).toBe(3);
		expect(state.currentSentence).toBe(0);
		expect(backend.spoken).toHaveLength(1);
		expect(backend.spoken[0].chunk).toBe('A.');
	});

	it('starts at the configured rate', () => {
		const { controller, backend } = makeController(1.5);
		controller.play(['A.', 'B.']);
		expect(backend.spoken[0].opts.rate).toBe(1.5);
	});

	it('advances when a sentence ends', () => {
		const { controller, backend } = makeController();
		controller.play(['A.', 'B.']);
		backend.finish();
		expect(controller.getState().currentSentence).toBe(1);
		expect(backend.spoken[1].chunk).toBe('B.');
	});

	it('finishes naturally after the last sentence', () => {
		const { controller, backend } = makeController();
		controller.play(['A.']);
		backend.finish();
		expect(controller.getState().isPlaying).toBe(false);
	});

	it('does not advance past a pause', () => {
		const { controller, backend } = makeController();
		controller.play(['A.', 'B.']);
		controller.pause();
		expect(controller.getState().isPaused).toBe(true);
		backend.finish();
		expect(controller.getState().currentSentence).toBe(0);
		expect(controller.getState().isPlaying).toBe(true);
		// Resume, then the (already consumed) end event's successor: the user
		// skipping forward must work while the chain is quiet.
		controller.resume();
		controller.skip(1);
		expect(backend.spoken[backend.spoken.length - 1].chunk).toBe('B.');
	});

	it('ignores stale events after stop', () => {
		const { controller, backend } = makeController();
		controller.play(['A.', 'B.']);
		controller.stop();
		expect(controller.getState().isPlaying).toBe(false);
		backend.finish(); // late onend from the cancelled utterance
		expect(controller.getState().isPlaying).toBe(false);
		expect(backend.spoken).toHaveLength(1);
	});

	it('stops playback on backend error', () => {
		const { controller, backend } = makeController();
		controller.play(['A.', 'B.']);
		backend.fail();
		expect(controller.getState().isPlaying).toBe(false);
	});

	it('skipTo clamps to the sentence range', () => {
		const { controller, backend } = makeController();
		controller.play(['A.', 'B.', 'C.']);
		controller.skipTo(99);
		expect(controller.getState().currentSentence).toBe(2);
		expect(backend.spoken[backend.spoken.length - 1].chunk).toBe('C.');
		controller.skipTo(-5);
		expect(controller.getState().currentSentence).toBe(0);
	});

	it('re-speaks the current sentence when the rate changes', () => {
		const { controller, backend } = makeController();
		controller.play(['A.', 'B.']);
		backend.finish(); // now on B
		controller.setRate(2);
		const last = backend.spoken[backend.spoken.length - 1];
		expect(last.chunk).toBe('B.');
		expect(last.opts.rate).toBe(2);
	});

	it('cycles rate through the fixed steps', () => {
		const { controller } = makeController(2);
		controller.cycleRate(); // 2 -> 1
		expect(controller.getState().rate).toBe(1);
		controller.cycleRate(); // 1 -> 1.25
		expect(controller.getState().rate).toBe(1.25);
	});

	it('plays nothing when handed an empty sentence list', () => {
		const { controller, backend } = makeController();
		controller.play([]);
		expect(controller.getState().isPlaying).toBe(false);
		expect(backend.spoken).toHaveLength(0);
	});
});
