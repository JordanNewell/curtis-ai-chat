// Agent Picker Modal — fuzzy-searchable named-agent selector. Dumb on
// purpose: it resolves nothing itself. `onChoose` receives the picked agent
// (or null for "default assistant"); `onCreate`, when given, receives the
// agent saved by the editor — otherwise the editor result routes to
// onChoose, so a create-from-picker flow binds the fresh agent immediately.

import { App, FuzzySuggestModal, setIcon } from 'obsidian';
import type { Agent } from '../../types';
import type CurtisPlugin from '../../main';
import { AgentEditorModal } from './agent-editor-modal';

type AgentPick = { kind: 'agent'; agent: Agent } | { kind: 'none' } | { kind: 'create' };

export class AgentPickerModal extends FuzzySuggestModal<AgentPick> {
	private plugin: CurtisPlugin;
	private onChoose: (agent: Agent | null) => void;
	private onCreate?: (agent: Agent | null) => void;

	constructor(
		app: App,
		plugin: CurtisPlugin,
		onChoose: (agent: Agent | null) => void,
		onCreate?: (agent: Agent | null) => void
	) {
		super(app);
		this.plugin = plugin;
		this.onChoose = onChoose;
		this.onCreate = onCreate;
		this.setPlaceholder('Search agents…');
		this.emptyStateText = 'No agents yet';
	}

	getItems(): AgentPick[] {
		const agents = this.plugin.agents.getAgents();
		if (agents.length === 0) return [{ kind: 'create' }];
		return [
			{ kind: 'none' },
			...agents.map((agent): AgentPick => ({ kind: 'agent', agent })),
			{ kind: 'create' },
		];
	}

	getItemText(item: AgentPick): string {
		if (item.kind === 'agent') return item.agent.name;
		if (item.kind === 'none') return 'Default assistant (no agent)';
		return 'Create new agent…';
	}

	renderSuggestion(item: { item: AgentPick }, el: HTMLElement): void {
		el.empty();
		el.addClass('ai-agent-suggestion');
		const pick = item.item;
		if (pick.kind === 'agent') {
			const emoji = el.createSpan({ cls: 'ai-agent-suggestion-emoji', text: `${pick.agent.emoji} ` });
			emoji.setAttribute('aria-hidden', 'true');
			el.createSpan({ cls: 'ai-agent-suggestion-name', text: pick.agent.name });
			const provider = this.plugin.providerRegistry.getProvider(pick.agent.providerId);
			el.createSpan({
				cls: 'ai-agent-suggestion-sub',
				text: `${provider?.name ?? pick.agent.providerId} · ${pick.agent.modelId}`,
			});
		} else if (pick.kind === 'none') {
			el.createSpan({ cls: 'ai-agent-suggestion-name', text: 'Default assistant' });
			el.createSpan({ cls: 'ai-agent-suggestion-sub', text: 'no agent — global system prompt' });
		} else {
			const icon = el.createSpan({ cls: 'ai-agent-suggestion-emoji' });
			setIcon(icon, 'plus');
			el.createSpan({ cls: 'ai-agent-suggestion-name', text: 'Create new agent…' });
		}
	}

	onChooseItem(pick: AgentPick): void {
		if (pick.kind === 'agent') {
			this.onChoose(pick.agent);
		} else if (pick.kind === 'none') {
			this.onChoose(null);
		} else {
			new AgentEditorModal(this.app, this.plugin, undefined, (saved) => {
				if (this.onCreate) this.onCreate(saved);
				else this.onChoose(saved);
			}).open();
		}
	}
}
