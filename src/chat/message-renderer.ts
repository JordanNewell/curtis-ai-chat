// Message Renderer — renders AI messages using Obsidian's MarkdownRenderer

import { MarkdownRenderer, Component } from 'obsidian';
import type { App } from 'obsidian';
import { faviconUrlFor, findVaultPathCandidates, resolveCandidates } from './linkify';

export class MessageRenderer {
	private app: App;
	/** Reads the favicons setting — injected so this class stays decoupled
	 *  from the plugin. Undefined/true both mean "show favicons". */
	private getShowFavicons?: () => boolean;
	private component: Component;
	/** Per-container pending stream state — arena mode streams into several
	 *  containers at once; a single shared slot would drop all but the last
	 *  writer each frame (and could overwrite a final render with a stale
	 *  non-final one). */
	private pendingStreams = new Map<HTMLElement, { content: string; final: boolean }>();
	private streamRafId: number | null = null;

	constructor(app: App, getShowFavicons?: () => boolean) {
		this.app = app;
		this.getShowFavicons = getShowFavicons;
		this.component = new Component();
		this.component.load();
	}

	/**
	 * Render markdown content into a container element.
	 * Returns the container with rendered content.
	 */
	async renderMessage(container: HTMLElement, content: string): Promise<void> {
		container.empty();

		// Render using Obsidian's built-in markdown renderer
		await MarkdownRenderer.render(
			this.app,
			content,
			container,
			'', // source path (no source file)
			this.component
		);

		// Post-processing: add copy buttons to code blocks, then link extras
		// (favicons on external links, tappable vault paths).
		this.addCodeBlockCopyButtons(container);
		this.enhanceLinks(container);
	}

	/**
	 * Append streamed content incrementally. During active streaming we render
	 * cheap plain-text via setText and coalesce via requestAnimationFrame so a
	 * fast token stream does not thrash MarkdownRenderer (which does full DOM
	 * teardown + re-parse per call). The final render — when the caller signals
	 * completion via `final=true` — runs the full markdown pipeline.
	 */
	renderStreamedMessage(container: HTMLElement, content: string, final = false): void {
		// Always update the pending content; the rAF callback renders the latest.
		this.pendingStreams.set(container, { content, final });

		if (this.streamRafId !== null) return; // already scheduled
		this.streamRafId = window.requestAnimationFrame(() => {
			this.streamRafId = null;
			const entries = Array.from(this.pendingStreams.entries());
			this.pendingStreams.clear();
			for (const [c, { content: text, final: isFinal }] of entries) {
				if (isFinal) {
					// Full markdown render on completion.
					void this.renderMessage(c, text);
				} else {
					// Cheap path during streaming: plain text in a <pre> so whitespace
					// and newlines are preserved without re-running MarkdownRenderer.
					c.empty();
					const pre = c.createEl('pre', { cls: 'ai-message-streaming-text' });
					pre.setText(text);
				}
			}
		});
	}

	/**
	 * Create or update the collapsible extended-thinking block (Anthropic
	 * extended thinking) that sits above the answer text. Called repeatedly
	 * with `streaming=true` while thinking deltas arrive — open, cheap
	 * setText updates — and once more with `streaming=false` when the answer
	 * takes over, which collapses the block unless the user toggled it.
	 */
	renderThinkingBlock(container: HTMLElement, text: string, streaming: boolean): void {
		const found = container.querySelector(':scope > details.ai-thinking-block');
		const details = found instanceof HTMLDetailsElement ? found : this.createThinkingBlock(container);
		details.toggleClass('is-streaming', streaming);
		const content = details.querySelector('.ai-thinking-content');
		if (content instanceof HTMLElement) content.setText(text);
		if (streaming) {
			details.open = true;
		} else if (details.dataset.userToggled !== 'open') {
			details.open = false;
		}
	}

	/** Build a fresh collapsed thinking block inside `container`. */
	private createThinkingBlock(container: HTMLElement): HTMLDetailsElement {
		const details = container.createEl('details', { cls: 'ai-thinking-block' });
		details.createEl('summary', { cls: 'ai-thinking-summary', text: 'Thinking' });
		details.createDiv({ cls: 'ai-thinking-content' });
		// Remember manual toggles so the final collapse doesn't fight a
		// user who deliberately opened (or closed) the block mid-stream.
		details.addEventListener('toggle', () => {
			details.dataset.userToggled = details.open ? 'open' : 'closed';
		});
		return details;
	}

	/**
	 * Add copy buttons to all code blocks in the container.
	 */
	private addCodeBlockCopyButtons(container: HTMLElement): void {
		const codeBlocks = Array.from(container.querySelectorAll('pre > code'));
		for (const block of codeBlocks) {
			const pre = block.parentElement;
			if (!pre || pre.querySelector('.ai-code-copy-btn')) continue;

			pre.addClass('ai-code-block');

			const btn = pre.createEl('button', {
				cls: 'ai-code-copy-btn',
				text: 'Copy',
			});

			btn.addEventListener('click', () => {
				const code = block.textContent || '';
				void navigator.clipboard.writeText(code).then(() => {
					btn.textContent = 'Copied!';
					window.setTimeout(() => {
						btn.textContent = 'Copy';
					}, 2000);
				}).catch(() => {
					// Clipboard denied — reset the label instead of leaving a
					// silent dead button and an unhandled rejection.
					btn.textContent = 'Copy failed';
					window.setTimeout(() => {
						btn.textContent = 'Copy';
					}, 2000);
				});
			});
		}
	}

	/**
	 * Link extras on fully rendered markdown: site favicons on external
	 * links, and plain vault paths made tappable with the native hover
	 * preview. Streaming passes skip this by design (cheap plain-text mode);
	 * the final render picks it up.
	 */
	private enhanceLinks(container: HTMLElement): void {
		this.decorateExternalLinks(container);
		this.linkifyVaultPaths(container);
	}

	/** Favicon + hostname tooltip on external links (setting: Link favicons). */
	private decorateExternalLinks(container: HTMLElement): void {
		const showFavicons = this.getShowFavicons?.() ?? true;
		for (const a of Array.from(container.querySelectorAll('a'))) {
			const href = a.getAttribute('href') ?? '';
			if (!/^https?:\/\//i.test(href)) continue;
			let host: string;
			try {
				host = new URL(href).hostname;
			} catch {
				continue; // malformed href — leave the anchor untouched
			}
			a.addClass('ai-link-external');
			a.setAttribute('title', host);
			if (!showFavicons || a.querySelector('.ai-link-favicon')) continue;
			// Created detached, error-wired, then given a src — a 404 or an
			// offline moment removes the placeholder instead of leaving a
			// broken-image glyph in the middle of a sentence.
			const img = a.createEl('img', { cls: 'ai-link-favicon', attr: { alt: '' } });
			img.referrerPolicy = 'no-referrer';
			img.loading = 'lazy';
			img.addEventListener('error', () => img.remove(), { once: true });
			img.src = faviconUrlFor(host);
			a.insertBefore(img, a.firstChild);
		}
	}

	/**
	 * Plain vault paths in assistant text ("Projects/Ideas.md") become
	 * tappable links: click opens the note, hover shows Obsidian's native
	 * page-preview popover. Already-linked text (markdown links, wikilinks),
	 * code, and tool output are skipped — only prose references linkify.
	 */
	private linkifyVaultPaths(container: HTMLElement): void {
		const paths = this.app.vault.getMarkdownFiles().map((f) => f.path);
		if (paths.length === 0) return;
		// ownerDocument, not the global: popout windows have their own document.
		const doc = container.ownerDocument;
		const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) =>
				node.parentElement?.closest('a, code, pre, .ai-vault-link')
					? NodeFilter.FILTER_REJECT
					: NodeFilter.FILTER_ACCEPT,
		});
		// Collect first — replacing nodes mid-walk would skip or revisit text.
		const textNodes: Text[] = [];
		while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

		let linked = false;
		for (const tn of textNodes) {
			const text = tn.textContent ?? '';
			const matches = resolveCandidates(findVaultPathCandidates(text), paths);
			if (matches.length === 0) continue;
			linked = true;
			const frag = createFragment();
			let cursor = 0;
			for (const m of matches) {
				if (m.start > cursor) frag.appendText(text.slice(cursor, m.start));
				const span = createSpan({ cls: 'ai-vault-link', text: m.text });
				span.dataset.path = m.path;
				frag.append(span);
				cursor = m.start + m.text.length;
			}
			if (cursor < text.length) frag.appendText(text.slice(cursor));
			tn.parentNode?.replaceChild(frag, tn);
		}

		if (!linked) return;
		for (const el of Array.from(container.querySelectorAll<HTMLElement>('.ai-vault-link'))) {
			const path = el.dataset.path;
			if (!path) continue;
			el.addEventListener('click', (evt) => {
				evt.preventDefault();
				void this.app.workspace.openLinkText(path, '', evt.ctrlKey || evt.metaKey);
			});
			// The core "Page preview" plugin answers hover-link; without it
			// the popover simply never shows — the click still opens the note.
			el.addEventListener('mouseenter', (evt) => {
				this.app.workspace.trigger('hover-link', {
					event: evt,
					source: 'curtis-ai-chat',
					targetEl: el,
					linktext: path,
					sourcePath: '',
				});
			});
		}
	}


	/**
	 * Render user content directly into the container. The container itself
	 * is the .ai-message-content wrapper built by the caller (ChatView).
	 * Preserves newlines and basic whitespace.
	 */
	renderUserMessage(container: HTMLElement, content: string): void {
		container.empty();
		container.addClass('ai-user-message-text');
		container.setText(content);
	}

	cleanup(): void {
		this.component.unload();
	}
}
