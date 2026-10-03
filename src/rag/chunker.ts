// Curtis — RAG chunker: split note text into overlapping chunks for embedding.
//
// Pure functions, no Obsidian imports — trivially testable.

export interface TextChunk {
	/** Chunk text as an exact slice of the source (separators included). */
	content: string;
	startIndex: number;
	endIndex: number;
}

/**
 * Split text into chunks of ~chunkSize characters with `overlap` characters
 * of carried context between consecutive chunks. Paragraph boundaries
 * (blank lines) are preferred break points; paragraphs larger than chunkSize
 * are hard-split into windows. Inputs are clamped: chunkSize >= 100,
 * 0 <= overlap < chunkSize / 2.
 */
export function chunkText(text: string, chunkSize: number, overlap: number): TextChunk[] {
	const size = Math.max(100, Math.floor(chunkSize));
	const ovl = Math.min(Math.max(0, Math.floor(overlap)), Math.floor(size / 2));
	if (!text || text.trim().length === 0) return [];

	// Paragraphs with original offsets; oversized paragraphs are pre-split
	// into <= size windows (with ovl overlap) so the packing loop stays simple.
	interface Piece { start: number; end: number }
	const pieces: Piece[] = [];

	const addPara = (start: number, end: number): void => {
		const raw = text.slice(start, end);
		if (raw.trim().length === 0) return;
		if (raw.length <= size) {
			pieces.push({ start, end });
			return;
		}
		const step = Math.max(1, size - ovl);
		let pos = start;
		while (pos < end) {
			const wEnd = Math.min(pos + size, end);
			pieces.push({ start: pos, end: wEnd });
			if (wEnd === end) break;
			pos += step;
		}
	};

	const paraRe = /\n\n+/g;
	let m: RegExpExecArray | null;
	let paraStart = 0;
	while ((m = paraRe.exec(text)) !== null) {
		addPara(paraStart, m.index);
		paraStart = m.index + m[0].length;
	}
	addPara(paraStart, text.length);

	// Greedy pack: append pieces while the chunk fits. Because a chunk is an
	// exact slice [start, end], its length is end - start (gaps included).
	const chunks: TextChunk[] = [];
	let start = -1;
	let end = -1;
	const flush = (): void => {
		if (start < 0) return;
		chunks.push({ content: text.slice(start, end), startIndex: start, endIndex: end });
	};
	for (const piece of pieces) {
		if (start < 0) {
			start = piece.start;
			end = piece.end;
			continue;
		}
		if (piece.end - start <= size) {
			end = piece.end;
			continue;
		}
		flush();
		// Seed the next chunk with the tail of the previous one (the overlap).
		// If even the tail plus this piece would overflow, drop the tail.
		const tailStart = Math.max(start, end - ovl);
		if (piece.end - tailStart <= size) {
			start = tailStart;
		} else {
			start = piece.start;
		}
		end = piece.end;
	}
	flush();
	return chunks;
}
