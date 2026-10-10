// Agent Editor Modal — create or edit a named agent: name, emoji, persona,
// model routing, tool ACL, remote-invocation gate, memory participation,
// optional loop-cap override.
// Saves through AgentManager (settings-backed); `onSave` receives the
// persisted agent so callers can bind it right away.

import { App, DropdownComponent, Modal, Notice, Setting } from 'obsidian';
import type { Agent } from '../../types';
import type CurtisPlugin from '../../main';
import { normalizeClaimsPolicy } from '../../agents/pcp';

export class AgentEditorModal extends Modal {
	private plugin: CurtisPlugin;
	private existing: Agent | undefined;
	private onSave: (agent: Agent) => void;

	// Working copy — committed on Save.
	private name: string;
	private emoji: string;
	private systemPrompt: string;
	private providerId: string;
	private modelId: string;
	private tools: { vault: boolean; web: boolean; mcp: boolean; gcp: boolean };
	private remote: boolean;
	private memory: 'inherit' | 'on' | 'off';
	private maxTurns: string; // '' = unset
	private claims: string; // comma-separated PEP classes; '' = no profile claims

	constructor(
		app: App,
		plugin: CurtisPlugin,
		existing: Agent | undefined,
		onSave: (agent: Agent) => void
	) {
		super(app);
		this.plugin = plugin;
		this.existing = existing;
		this.onSave = onSave;
		this.name = existing?.name ?? '';
		this.emoji = existing?.emoji ?? '🤖';
		this.systemPrompt = existing?.systemPrompt ?? '';
		this.providerId = existing?.providerId ?? plugin.settings.activeProvider;
		this.modelId = existing?.modelId ?? plugin.settings.activeModel;
		this.tools = { vault: true, web: false, mcp: false, gcp: false, ...(existing?.tools ?? {}) };
		this.remote = existing?.remote ?? false;
		this.memory = existing?.memory ?? 'inherit';
		this.maxTurns = existing?.maxTurns !== undefined ? String(existing.maxTurns) : '';
		this.claims = (existing?.claims ?? []).join(', ');
		this.setTitle(existing ? `Edit agent: ${existing.name}` : 'New agent');
		this.modalEl.addClass('ai-agent-editor');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName('Name')
			.setDesc('What this worker is called — used by /agent and the swarm roster')
			.addText((text) => {
				text.setValue(this.name).onChange((v) => { this.name = v; });
				text.inputEl.focus();
			});

		new Setting(contentEl)
			.setName('Emoji')
			.setDesc('Shown on the header pill')
			.addText((text) => {
				text.setValue(this.emoji).onChange((v) => { this.emoji = v; });
			});

		new Setting(contentEl).setName('Model routing').setHeading();
		const modelSetting = new Setting(contentEl)
			.setName('Provider / model')
			.setDesc('This agent\'s requests always go here — the lane, not the pane picker');
		this.buildModelDropdowns(modelSetting);

		new Setting(contentEl).setName('Persona').setHeading();
		new Setting(contentEl)
			.setName('Role prompt')
			.setDesc('The role. Layered after the core harness prompt and your global system prompt — the role wins ties.')
			.addTextArea((area) => {
				area.setValue(this.systemPrompt).onChange((v) => { this.systemPrompt = v; });
				area.inputEl.rows = 6;
				area.inputEl.addClass('ai-agent-editor-persona');
			});

		new Setting(contentEl).setName('Tool access').setHeading();
		const toolsNote = contentEl.createEl('p', { cls: 'ai-setting-hint' });
		toolsNote.setText('Ceilings on top of the global toggles — an agent can only narrow what Curtis allows, never widen it.');
		new Setting(contentEl)
			.setName('Vault tools')
			.setDesc('Read/search/create/edit notes, semantic search, shell')
			.addToggle((t) => t.setValue(this.tools.vault).onChange((v) => { this.tools.vault = v; }));
		new Setting(contentEl)
			.setName('Web tools')
			.setDesc('Web search and the URL reader')
			.addToggle((t) => t.setValue(this.tools.web).onChange((v) => { this.tools.web = v; }));
		new Setting(contentEl)
			.setName('MCP tools')
			.setDesc('tools from connected MCP servers')
			.addToggle((t) => t.setValue(this.tools.mcp).onChange((v) => { this.tools.mcp = v; }));
		new Setting(contentEl)
			.setName('GCP tools')
			.setDesc('read-only Cloud Storage on the connected GCP project')
			.addToggle((t) => t.setValue(this.tools.gcp).onChange((v) => { this.tools.gcp = v; }));
		new Setting(contentEl)
			.setName('Remote invocation')
			.setDesc('Allow MCP clients and plugins to run this agent headlessly (run_agent / api.runAgent). The agent keeps its own model routing and runs at your cost.')
			.addToggle((t) => t.setValue(this.remote).onChange((v) => { this.remote = v; }));

		new Setting(contentEl).setName('Boundaries').setHeading();
		new Setting(contentEl)
			.setName('Memory')
			.setDesc('Off keeps a local-only agent\'s facts out of the shared memory file — otherwise what it learns can later ride to a cloud chat')
			.addDropdown((dd) => {
				dd.addOption('inherit', 'Follow global memory setting');
				dd.addOption('on', 'Always on');
				dd.addOption('off', 'Off — this agent never reads or writes memory');
				dd.setValue(this.memory);
				dd.onChange((v) => { this.memory = v as Agent['memory']; });
			});
		new Setting(contentEl)
			.setName('Max tool turns')
			.setDesc('Override of the global agent loop cap for this agent (blank = global default)')
			.addText((text) => {
				text.setValue(this.maxTurns).onChange((v) => { this.maxTurns = v; });
			});
		new Setting(contentEl)
			.setName('Profile claims')
			.setDesc(`Consent policy — claim classes this agent may see from ${this.plugin.settings.pcpFilePath} (PEP-P personality, PEP-D developer, …). Comma-separated; * = all; empty = no profile claims.`)
				.addText((text) => {
					text.setPlaceholder('Example: PEP-P');
				text.setValue(this.claims).onChange((v) => { this.claims = v; });
			});

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) => btn.setButtonText(this.existing ? 'Save' : 'Create agent').setCta().onClick(() => this.commit()));
	}

	/** Provider + model dropdown pair; the model list repopulates when the
	 *  provider changes. Only enabled providers are offered. */
	private buildModelDropdowns(setting: Setting): void {
		const enabled = this.plugin.providerRegistry
			.getAllDefinitions()
			.filter((d) => this.plugin.settings.providerConfigs[d.id]?.enabled);
		setting.addDropdown((dd) => {
			for (const def of enabled) dd.addOption(def.id, def.name);
			if (!enabled.some((d) => d.id === this.providerId)) this.providerId = enabled[0]?.id ?? this.providerId;
			dd.setValue(this.providerId);
			dd.onChange((v) => {
				this.providerId = v;
				const first = this.plugin.providerRegistry.getProvider(v)?.models[0]?.id;
				if (first) {
					this.modelId = first;
					this.populateModelDropdown();
				}
			});
		});
		setting.addDropdown((dd) => {
			this.modelDropdown = dd;
			dd.onChange((v) => { this.modelId = v; });
			this.populateModelDropdown();
		});
	}

	private modelDropdown: DropdownComponent | null = null;

	private populateModelDropdown(): void {
		const dd = this.modelDropdown;
		if (!dd) return;
		dd.selectEl.empty();
		const models = this.plugin.providerRegistry.getProvider(this.providerId)?.models ?? [];
		for (const m of models) dd.addOption(m.id, m.name);
		if (models.length > 0 && !models.some((m) => m.id === this.modelId)) {
			this.modelId = models[0].id;
		}
		dd.setValue(this.modelId);
	}

	private commit(): void {
		const name = this.name.trim();
		if (!name) {
			new Notice('Name is required');
			return;
		}
		let turns: number | undefined;
		if (this.maxTurns.trim()) {
			const n = Number(this.maxTurns);
			if (!Number.isFinite(n) || n < 1) {
				new Notice('Max tool turns must be a number ≥ 1');
				return;
			}
			turns = Math.floor(n);
		}
		const claims = normalizeClaimsPolicy(this.claims.split(','));
		const shared = {
			name,
			emoji: this.emoji.trim() || '🤖',
			systemPrompt: this.systemPrompt,
			providerId: this.providerId,
			modelId: this.modelId,
			tools: { ...this.tools },
			remote: this.remote,
			memory: this.memory,
		};
		const saved = this.existing
			? (this.plugin.agents.updateAgent(this.existing.id, {
					...shared,
					...(turns !== undefined ? { maxTurns: turns } : { maxTurns: undefined }),
					...(claims.length > 0 ? { claims } : { claims: undefined }),
				}), this.plugin.agents.getAgent(this.existing.id)!)
			: this.plugin.agents.createAgent({
					...shared,
					...(turns !== undefined ? { maxTurns: turns } : {}),
					...(claims.length > 0 ? { claims } : {}),
				});
		this.onSave(saved);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
