// Voice I/O helpers — speech-to-text (Whisper) + text-to-speech (Web Speech API).
//
// The STT path uses raw fetch() against OpenAI's /v1/audio/transcriptions
// endpoint because the Whisper API requires multipart/form-data and Obsidian's
// requestUrl helper does not support FormData bodies. The same architectural
// justification as transport.ts (fetch required for mobile streaming) applies.

/**
 * Speech-to-text via OpenAI Whisper.
 *
 * `bearerToken` should already include the `Bearer ` prefix.
 *
 * Returns transcribed text or throws on error.
 */
export async function transcribeAudio(
	audioBlob: Blob,
	bearerToken: string,
	model = 'whisper-1'
): Promise<string> {
	const formData = new FormData();
	const filename = audioBlob.type.includes('mp4') ? 'recording.mp4' : 'recording.webm';
	formData.append('file', audioBlob, filename);
	formData.append('model', model);
	formData.append('response_format', 'text');

	// fetch() is architecturally required here — Obsidian's requestUrl does
	// not support multipart/form-data bodies, which the Whisper API requires.
	// eslint-disable-next-line no-restricted-globals
	const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
		method: 'POST',
		headers: {
			Authorization: bearerToken,
		},
		body: formData,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Whisper API error (${response.status}): ${errorText}`);
	}

	return (await response.text()).trim();
}

/**
 * Strip markdown for cleaner speech. Code fences, inline code, bold, links,
 * headings, and list markers are normalized so the synthesized voice reads
 * naturally instead of reciting punctuation.
 */
export function cleanTextForSpeech(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, ' code block ')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/^#+\s+/gm, '')
		.replace(/^\s*[-*]\s+/gm, '')
		.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
		.trim();
}

/**
 * Text-to-speech using the browser's built-in speechSynthesis.
 * Picks a voice that matches the user's locale if available.
 */
export function speakText(
	text: string,
	opts?: { onStart?: () => void; onEnd?: () => void; onError?: () => void }
): void {
	if (!isSpeechSupported()) {
		console.warn('[Curtis] speechSynthesis unavailable');
		opts?.onError?.();
		return;
	}

	// Cancel any in-progress speech so rapid clicks don't queue utterances.
	window.speechSynthesis.cancel();

	const cleanText = cleanTextForSpeech(text);
	if (!cleanText) {
		opts?.onEnd?.();
		return;
	}

	const utterance = new SpeechSynthesisUtterance(cleanText);
	utterance.rate = 1.0;
	utterance.pitch = 1.0;
	utterance.volume = 1.0;

	// Pick a voice — prefer en-US default, then any English voice, then first.
	const voices = window.speechSynthesis.getVoices();
	const preferredVoice =
		voices.find((v) => v.lang === 'en-US' && v.default) ||
		voices.find((v) => v.lang.startsWith('en')) ||
		voices[0];
	if (preferredVoice) utterance.voice = preferredVoice;

	if (opts?.onStart) utterance.onstart = opts.onStart;
	if (opts?.onEnd) {
		utterance.onend = opts.onEnd;
		utterance.onerror = opts.onEnd;
	} else if (opts?.onError) {
		utterance.onerror = opts.onError;
	}

	window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
	if (isSpeechSupported()) {
		window.speechSynthesis.cancel();
	}
}

export function isSpeechSupported(): boolean {
	return 'speechSynthesis' in window;
}

export function isMediaRecorderSupported(): boolean {
	return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices;
}

/**
 * Record audio from the microphone. Call start() to begin, stop() to receive
 * the captured Blob, or cancel() to discard without resolving.
 */
export class VoiceRecorder {
	private mediaRecorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private stream: MediaStream | null = null;

	async start(): Promise<void> {
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		this.chunks = [];

		const mimeType = this.pickMimeType();
		this.mediaRecorder = mimeType
			? new MediaRecorder(this.stream, { mimeType })
			: new MediaRecorder(this.stream);

		this.mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.chunks.push(e.data);
		};

		this.mediaRecorder.start();
	}

	stop(): Promise<Blob> {
		return new Promise((resolve) => {
			if (!this.mediaRecorder) {
				resolve(new Blob());
				return;
			}

			this.mediaRecorder.onstop = () => {
				const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
				const blob = new Blob(this.chunks, { type: mimeType });
				this.cleanup();
				resolve(blob);
			};

			this.mediaRecorder.stop();
		});
	}

	cancel(): void {
		if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
			this.mediaRecorder.stop();
		}
		this.cleanup();
	}

	private cleanup(): void {
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
		this.mediaRecorder = null;
		this.chunks = [];
	}

	private pickMimeType(): string | null {
		const candidates = [
			'audio/webm;codecs=opus',
			'audio/webm',
			'audio/ogg;codecs=opus',
			'audio/mp4',
		];
		for (const type of candidates) {
			if (MediaRecorder.isTypeSupported(type)) return type;
		}
		return null;
	}
}
