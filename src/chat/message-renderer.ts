// Message Renderer — renders AI messages using Obsidian's MarkdownRenderer

import { MarkdownRenderer, Component } from 'obsidian';
import type { App } from 'obsidian';

export class MessageRenderer {
	private app: App;
	private component: Component;
	private pendingStreamContainer: HTMLElement | null = null;
	private pendingStreamContent = '';
	private pendingStreamFinal = false;
	private streamRafId: number | null = null;

	constructor(app: App) {
		this.app = app;
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

		// Post-processing: add copy buttons to code blocks
		this.addCodeBlockCopyButtons(container);
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
		this.pendingStreamContent = content;
		this.pendingStreamContainer = container;
		this.pendingStreamFinal = final;

		if (this.streamRafId !== null) return; // already scheduled
		this.streamRafId = window.requestAnimationFrame(() => {
			this.streamRafId = null;
			const c = this.pendingStreamContainer;
			const text = this.pendingStreamContent;
			const isFinal = this.pendingStreamFinal;
			if (!c) return;
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
		});
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
				navigator.clipboard.writeText(code).then(() => {
					btn.textContent = 'Copied!';
					window.setTimeout(() => {
						btn.textContent = 'Copy';
					}, 2000);
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
