// Stub for the `obsidian` module when bundling scripts/models-smoke-entry.ts
// with esbuild (node has no Obsidian runtime). Unlike scripts/obsidian-stub.ts
// (which must never see a request), this stub FAKES the network: the entry
// installs a router, every requestUrl call is answered in-process, and each
// request is recorded so the assertions can inspect URLs and headers.

export interface StubRequest {
	url: string;
	method?: string;
	headers?: Record<string, string>;
}

export interface StubResponse {
	status: number;
	json?: unknown;
}

export type StubRouter = (req: StubRequest) => StubResponse;

// Default 404s — a provider the test didn't plan for must fail discovery
// quietly, exactly like an unreachable endpoint, never throw.
let router: StubRouter = () => ({ status: 404 });

/** Requests exactly as the registry sent them, for URL/header assertions. */
export const requestsSeen: StubRequest[] = [];

export function __setRequestRouter(r: StubRouter): void {
	router = r;
}

export function requestUrl(req: StubRequest): Promise<StubResponse> {
	requestsSeen.push({ ...req, headers: { ...(req.headers || {}) } });
	return Promise.resolve(router(req));
}

// transport.ts pulls Platform off the module; unused in this smoke but the
// bundler resolves every named import in the graph.
export const Platform = { isDesktop: true, isMobile: false, isMobileApp: false };

// The registry's import graph reaches into tools/vault/settings code that
// names other obsidian exports. None of it executes in this smoke — dummies
// exist purely so esbuild resolves every named import.
class Dummy {}
export class App extends Dummy {}
export class Component extends Dummy {}
export class Editor extends Dummy {}
export class FuzzySuggestModal extends Dummy {}
export class ItemView extends Dummy {}
export class MarkdownRenderer extends Dummy {}
export class MarkdownView extends Dummy {}
export class Menu extends Dummy {}
export class Modal extends Dummy {}
export class Notice extends Dummy {
	constructor(public message: string) {
		super();
	}
}
export class Plugin extends Dummy {}
export class PluginSettingTab extends Dummy {}
export class Setting extends Dummy {}
export class TFile extends Dummy {}
export class TFolder extends Dummy {}
export class WorkspaceLeaf extends Dummy {}
export const debounce = (fn: () => void) => fn;
export const parseYaml = (s: string) => s;
export const prepareFuzzySearch = () => () => null;
export const setIcon = () => undefined;
export const stringifyYaml = (v: unknown) => String(v);
export default {};
