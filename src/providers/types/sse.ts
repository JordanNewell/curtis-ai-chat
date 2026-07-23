// Shared SSE line-parsing utilities used by all streaming providers.

export interface SSEEvent { event?: string; data: string }

/** Parse one SSE block (separated by \n\n) into an event. */
export function parseSSEBlock(block: string): SSEEvent {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  return { event, data: dataLines.join('\n') };
}

/** Split a raw SSE stream into individual events. */
export function* iterateSSE(rawText: string): Generator<SSEEvent> {
  for (const block of rawText.split('\n\n')) {
    if (block.trim()) yield parseSSEBlock(block);
  }
}
