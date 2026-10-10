// Scheduled Job Modal — form for creating/editing a scheduled agent run.
//
// The schedule picker is two shapes, not free-form cron: daily-at-time and
// every-N-minutes cover real vault jobs, and the run only fires while
// Obsidian is open anyway (the hint below says so up front).

import { Modal, Setting } from 'obsidian';
import type CurtisPlugin from '../../main';
import type { ScheduledJob, ScheduledJobSchedule } from '../../types';
import { parseDailyTime } from '../../scheduler/schedule';

export type ScheduledJobResult = Omit<ScheduledJob, 'createdAt' | 'lastFiredAt' | 'lastStatus' | 'lastError' | 'lastDurationMs' | 'lastRunPath'>;

export class ScheduledJobModal extends Modal {
	private plugin: CurtisPlugin;
	private onSubmit: (job: ScheduledJobResult) => void;
	private existing?: ScheduledJob;

	private name = '';
	private prompt = '';
	private agentName = '';
	private kind: 'daily' | 'interval' = 'daily';
	private time = '09:00';
	private minutes = '60';
	private enabled = true;
	private errorEl?: HTMLElement;
	private scheduleParamsEl?: HTMLElement;

	constructor(
		plugin: CurtisPlugin,
		onSubmit: (job: ScheduledJobResult) => void,
		existing?: ScheduledJob
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.onSubmit = onSubmit;
		this.existing = existing;
		if (existing) {
			this.name = existing.name;
			this.prompt = existing.prompt;
			this.agentName = existing.agentName ?? '';
			this.kind = existing.schedule.kind;
			if (existing.schedule.kind === 'daily') this.time = existing.schedule.time;
			else this.minutes = String(existing.schedule.minutes);
			this.enabled = existing.enabled;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.existing ? 'Edit scheduled run' : 'New scheduled run' });

		new Setting(contentEl)
			.setName('Name')
			.setDesc('Also names the run note ("Weekly review 2026-10-12 09-00.md")')
			.addText((t) => {
				t.setPlaceholder('Morning digest')
					.setValue(this.name)
					.onChange((v) => (this.name = v));
			});

		new Setting(contentEl)
			.setName('Task')
			.setDesc('The prompt the agent runs headlessly. Vault tools stay available — it can read, search, and write notes.')
			.addTextArea((t) => {
				t.setPlaceholder("Summarize yesterday's conversations in AI/Conversations into a digest note.")
					.setValue(this.prompt)
					.onChange((v) => (this.prompt = v));
				t.inputEl.rows = 5;
			});

		const agents = this.plugin.settings.agents;
		new Setting(contentEl)
			.setName('Run as')
			.setDesc('A named agent runs with its persona, model routing, and tool ceilings. Runs fail on agents whose remote-invocation toggle (agent editor) is off — ⚠ marks those.')
			.addDropdown((dd) => {
				// Values are agent NAMES — api.runAgent resolves by name, and the
				// stored job.agentName must round-trip through this dropdown.
				dd.addOption('', 'Default assistant');
				for (const agent of agents) {
					dd.addOption(agent.name, `${agent.emoji} ${agent.name}${agent.remote === true ? '' : ' ⚠'}`);
				}
				dd.setValue(this.agentName);
				dd.onChange((v) => (this.agentName = v));
			});

		new Setting(contentEl)
			.setName('Schedule')
			.setDesc('Runs only while Obsidian is open — a daily job missed while closed fires once on the next launch; interval runs re-anchor from that catch-up.')
			.addDropdown((dd) => {
				dd.addOption('daily', 'Daily at a time');
				dd.addOption('interval', 'On a repeating interval');
				dd.setValue(this.kind);
				dd.onChange((v) => {
					this.kind = v === 'interval' ? 'interval' : 'daily';
					this.renderScheduleParams();
				});
			});

		// Conditional inputs for the selected shape, re-rendered on change.
		this.scheduleParamsEl = contentEl.createDiv();
		this.renderScheduleParams();

		new Setting(contentEl)
			.setName('Enabled')
			.setDesc('Paused jobs keep their history and can still be run manually')
			.addToggle((t) => {
				t.setValue(this.enabled).onChange((v) => (this.enabled = v));
			});

		this.errorEl = contentEl.createEl('p', {
			cls: 'ai-setting-hint ai-form-error',
			text: '',
		});

		const buttonRow = contentEl.createDiv({ cls: 'ai-modal-button-row' });
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel', cls: 'ai-modal-btn-secondary' });
		cancelBtn.addEventListener('click', () => this.close());
		const saveBtn = buttonRow.createEl('button', {
			text: this.existing ? 'Save' : 'Add run',
			cls: 'mod-cta ai-modal-btn-primary',
		});
		saveBtn.addEventListener('click', () => this.submit());
	}

	private renderScheduleParams(): void {
		const host = this.scheduleParamsEl;
		if (!host) return;
		host.empty();
		if (this.kind === 'daily') {
			new Setting(host)
				.setName('Time')
				.setDesc('Local 24-hour time — fires once per day at/after this moment')
				.addText((t) => {
					t.setPlaceholder('09:00').setValue(this.time).onChange((v) => (this.time = v));
				});
		} else {
			new Setting(host)
				.setName('Minutes')
					.setDesc('Minutes between runs (5–10080 — up to one week)')
				.addText((t) => {
					t.setPlaceholder('60').setValue(this.minutes).onChange((v) => (this.minutes = v));
				});
		}
	}

	private submit(): void {
		const name = this.name.trim();
		const prompt = this.prompt.trim();
		if (!name) {
			this.showError('A name is required.');
			return;
		}
		if (!prompt) {
			this.showError('A task prompt is required.');
			return;
		}
		let schedule: ScheduledJobSchedule;
		if (this.kind === 'daily') {
			const parsed = parseDailyTime(this.time);
			if (!parsed) {
				this.showError('Time must be HH:MM (24-hour), e.g. 09:00.');
				return;
			}
			const normalized = `${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}`;
			schedule = { kind: 'daily', time: normalized };
		} else {
			const minutes = Number.parseInt(this.minutes, 10);
			if (!Number.isFinite(minutes) || minutes < 5 || minutes > 10080) {
				this.showError('Minutes must be a whole number between 5 and 10080.');
				return;
			}
			schedule = { kind: 'interval', minutes };
		}

		// agentName is set explicitly (undefined for the default assistant), not
		// conditionally spread — Object.assign in the settings editor must be
		// able to clear a previously chosen agent.
		const agent = this.plugin.settings.agents.find((a) => a.name === this.agentName);
		this.onSubmit({
			id: this.existing?.id || `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			name,
			enabled: this.enabled,
			prompt,
			agentName: agent ? agent.name : undefined,
			schedule,
		});
		this.close();
	}

	private showError(message: string): void {
		if (this.errorEl) this.errorEl.setText(message);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
