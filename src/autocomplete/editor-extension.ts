// Editor ghost-text autocomplete — CodeMirror 6 extension.
//
// One registration in onload serves every editor (and popout window). The
// per-editor state lives in the ViewPlugin instance (its controller) and the
// ghostField (the rendered suggestion). Typing schedules; the controller's
// snapshot check decides whether a response still deserves to render; Tab
// (only while a ghost is visible) inserts in a single transaction so one
// undo step removes it.
//
// Suppressions, all deliberate: IME composition (a ghost mid-composition
// corrupts CJK input), non-empty selections, multi-cursor, read-only files,
// cursors not at end of line, and mobile (the extension is never registered
// there).

import { EditorView, ViewPlugin, ViewUpdate, Decoration, WidgetType, keymap } from '@codemirror/view';
import { Prec, StateEffect, StateField, type Extension, type TransactionSpec } from '@codemirror/state';
import { Notice } from 'obsidian';
import type CurtisPlugin from '../main';
import { AutocompleteController, DEFAULT_AUTOCOMPLETE_CONFIG } from './controller';
import { buildCompletionMessages, extractCompletion } from './completion';

interface GhostState {
	text: string;
	pos: number;
}

const setGhost = StateEffect.define<GhostState>();
const clearGhost = StateEffect.define<null>();

const ghostField = StateField.define<GhostState | null>({
	create: () => null,
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setGhost)) return { text: effect.value.text, pos: effect.value.pos };
			if (effect.is(clearGhost)) return null;
		}
		// Any foreign doc change invalidates the ghost: positions shift, and the
		// controller's snapshot check would discard it on the next keystroke.
		if (tr.docChanged) return null;
		return value;
	},
});

class GhostWidget extends WidgetType {
	constructor(readonly text: string) {
		super();
	}

	override eq(other: GhostWidget): boolean {
		return other.text === this.text;
	}

	override toDOM(): HTMLElement {
		// createSpan is an Obsidian global (declare global in obsidian.d.ts).
		return createSpan({ cls: 'cm-ghost-suggestion', text: this.text });
	}

	override ignoreEvent(): boolean {
		return true;
	}
}

const ghostDecorations = EditorView.decorations.compute([ghostField], (state) => {
	const ghost = state.field(ghostField);
	if (!ghost) return Decoration.none;
	return Decoration.set([
		Decoration.widget({ widget: new GhostWidget(ghost.text), side: 1 }).range(ghost.pos),
	]);
});

/** Accept-key variants — settings.autocompleteAcceptKey selects one. */
type AcceptKey = 'tab' | 'alt-tab' | 'ctrl-arrow';

export function createAutocompleteExtension(plugin: CurtisPlugin): Extension {
	const settings = () => plugin.settings;

	const fullPreCursor = (view: EditorView, upto: number): string =>
		view.state.doc.sliceString(0, upto);

	const truncatedPreCursor = (view: EditorView, upto: number): string =>
		view.state.doc.sliceString(Math.max(0, upto - DEFAULT_AUTOCOMPLETE_CONFIG.prefixChars), upto);

	const suffixAfter = (view: EditorView, from: number): string =>
		view.state.doc.sliceString(from, Math.min(view.state.doc.length, from + DEFAULT_AUTOCOMPLETE_CONFIG.suffixChars));

	/** Ghost position, or null when none is showing. */
	const currentGhost = (view: EditorView): GhostState | null =>
		view.state.field(ghostField, false) ?? null;

	const hideGhost = (view: EditorView): void => {
		if (currentGhost(view) !== null) view.dispatch({ effects: clearGhost.of(null) });
	};

	/** Resolve the autocomplete provider/model, falling back to the active
	 *  chat pair when none is configured. Null = feature cannot run. */
	const resolveTarget = (): { providerId: string; modelId: string } | null => {
		const s = settings();
		const providerId = s.autocompleteProviderId || s.activeProvider;
		const modelId = s.autocompleteModelId || s.activeModel;
		if (!providerId || !modelId) return null;
		return { providerId, modelId };
	};

	const acceptGhost = (view: EditorView, variant: AcceptKey): boolean => {
		if (settings().autocompleteAcceptKey !== variant) return false;
		const ghost = currentGhost(view);
		if (!ghost) return false;
		const controller = view.plugin(autoSuggest)?.controller;
		if (!controller) return false;
		// Full new pre-cursor text (untruncated) — the controller's accept
		// suppression compares it as a supertail of future truncated prefixes.
		controller.accept(fullPreCursor(view, ghost.pos) + ghost.text);
		const spec: TransactionSpec = {
			changes: { from: ghost.pos, insert: ghost.text },
			selection: { anchor: ghost.pos + ghost.text.length },
			effects: clearGhost.of(null),
			userEvent: 'input.complete',
		};
		view.dispatch(spec);
		return true;
	};

	const dismissGhost = (view: EditorView): boolean => {
		const ghost = currentGhost(view);
		if (!ghost) return false;
		const controller = view.plugin(autoSuggest)?.controller;
		if (controller) controller.dismiss(fullPreCursor(view, ghost.pos));
		view.dispatch({ effects: clearGhost.of(null) });
		return true;
	};

	const autoSuggest = ViewPlugin.fromClass(
		class {
			readonly controller: AutocompleteController;
			private featureWasActive = false;

			constructor(readonly view: EditorView) {
				const s = settings();
				this.controller = new AutocompleteController(
					{
						execute: (prefix, suffix, signal) => this.executeCompletion(prefix, suffix, signal),
						currentPrefix: () => fullPreCursor(this.view, this.view.state.selection.main.head),
						currentSuffix: () => suffixAfter(this.view, this.view.state.selection.main.head),
						context: () => {
							const t = resolveTarget();
							return t ? `${t.providerId}\u0001${t.modelId}` : 'disabled';
						},
						show: (text) => {
							// Belt-and-suspenders against the edges the controller
							// can't see: editor blurred, or IME composition started
							// while the request was in flight.
							if (!this.view.hasFocus || this.view.compositionStarted) return;
							this.view.dispatch({
								effects: setGhost.of({ text, pos: this.view.state.selection.main.head }),
							});
						},
						notify: (message) => new Notice(message, 4000),
					},
					{ debounceMs: s.autocompleteDebounceMs, minChars: s.autocompleteMinChars }
				);
			}

			update(update: ViewUpdate): void {
				const active = settings().enableAutocomplete && resolveTarget() !== null;
				if (!active) {
					if (this.featureWasActive) {
						this.controller.dispose();
						hideGhost(this.view);
						this.featureWasActive = false;
					}
					return;
				}
				this.featureWasActive = true;
				// IME composition: keystrokes are building foreign characters —
				// never schedule during, and the post-commit change schedules
				// naturally once composing clears.
				if (update.view.compositionStarted) return;
				if (update.docChanged) {
					this.maybeSchedule();
					return;
				}
				if (update.selectionSet) hideGhost(this.view);
			}

			private maybeSchedule(): void {
				const view = this.view;
				const selection = view.state.selection.main;
				if (!selection.empty) return;
				if (view.state.selection.ranges.length > 1) return;
				if (view.state.readOnly) return;
				const head = selection.head;
				// v1: end-of-line only — mid-line completion is FIM territory.
				if (head !== view.state.doc.lineAt(head).to) return;
				this.controller.schedule(truncatedPreCursor(view, head), suffixAfter(view, head));
			}

			private async executeCompletion(
				prefix: string,
				suffix: string,
				signal: AbortSignal
			): Promise<{ text: string; tokens: number }> {
				const target = resolveTarget();
				if (!target) return { text: '', tokens: 0 };
				const messages = buildCompletionMessages(prefix, suffix, {
					prefixChars: DEFAULT_AUTOCOMPLETE_CONFIG.prefixChars,
					suffixChars: DEFAULT_AUTOCOMPLETE_CONFIG.suffixChars,
				});
				const raw = await plugin.callCompletion(target.providerId, target.modelId, messages, signal);
				plugin.recordAutocompleteUsage(raw.tokens);
				return { text: extractCompletion(raw.text, /\s$/.test(prefix)), tokens: raw.tokens };
			}

			destroy(): void {
				this.controller.dispose();
			}
		}
	);

	const domEvents = EditorView.domEventHandlers({
		blur: (_event, view) => {
			hideGhost(view);
			return false;
		},
	});

	const keys = keymap.of([
		{ key: 'Tab', run: (view) => acceptGhost(view, 'tab') },
		{ key: 'Alt-Tab', run: (view) => acceptGhost(view, 'alt-tab') },
		{ key: 'Ctrl-ArrowRight', run: (view) => acceptGhost(view, 'ctrl-arrow') },
		{ key: 'Escape', run: (view) => dismissGhost(view) },
	]);

	// Prec.highest: while a ghost is visible the accept key wins; with no
	// ghost every handler returns false and Tab/Escape behave exactly as the
	// user (and vim mode) expects.
	return [ghostField, ghostDecorations, autoSuggest, domEvents, Prec.highest(keys)];
}
