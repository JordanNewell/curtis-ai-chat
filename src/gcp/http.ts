// Injectable HTTP layer for the GCP modules.
//
// Types only, Obsidian-free — auth.ts and storage.ts take a sender instead
// of importing requestUrl, so the token exchange and the Storage API wire
// logic run (and are unit-tested) under node. The requestUrl-backed default
// sender lives in manager.ts, which already imports obsidian.

export interface HttpSendRequest {
	url: string;
	method: 'GET' | 'POST';
	headers: Record<string, string>;
	body?: string;
}

export interface HttpSendResponse {
	status: number;
	text: string;
}

export type HttpSender = (req: HttpSendRequest) => Promise<HttpSendResponse>;
