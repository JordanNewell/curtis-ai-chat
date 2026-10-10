// Scheduled runs — a best-effort trigger layer over the headless agent API.
//
// An Obsidian plugin only executes while Obsidian is open (and on mobile,
// only while foregrounded), so this is deliberately NOT cron: one 30s tick
// checks persisted job specs and fires the due ones through api.chat() /
// api.runAgent(). Wall-clock precision is impossible to promise; catch-up
// semantics are (see schedule.ts and docs/SCHEDULED_RUNS.md).
//
// Failure posture follows the license revalidator: a scheduled run is
// unattended, so it must never throw into the tick, spam dialogs, or wedge
// the plugin — one Notice per finished run, full detail in the run note.

import { Notice } from 'obsidian';
import type CurtisPlugin from '../main';
import type { ScheduledJob } from '../types';
import { createNote } from '../vault/notes';
import { describeSchedule, isJobDue } from './schedule';

/** How often the due-check runs. 30s is the floor on firing latency; the
 *  cost is one loop over a handful of persisted job objects. */
const TICK_MS = 30_000;

/** First check waits this long after boot — provider discovery and vault
 *  indexing are still settling, and a catch-up run racing them helps no one. */
const FIRST_TICK_DELAY_MS = 20_000;

export class SchedulerService {
	private plugin: CurtisPlugin;
	/** In-flight runs keyed by job id — the skip-if-running guard, and the
	 *  handle abort on unload. */
	private running = new Map<string, AbortController>();
	private tickInterval: number | null = null;
	private bootTimer: number | null = null;
	private stopped = true;

	constructor(plugin: CurtisPlugin) {
		this.plugin = plugin;
	}

	start(): void {
		if (!this.stopped) return;
		this.stopped = false;
		this.bootTimer = window.setTimeout(() => {
			this.bootTimer = null;
			void this.tick();
		}, FIRST_TICK_DELAY_MS);
		this.tickInterval = this.plugin.registerInterval(window.setInterval(() => void this.tick(), TICK_MS));
	}

	/** Abort in-flight runs and stop ticking. Runs aborted here record the
	 *  attempt but don't write a run note — the plugin is going away. */
	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		if (this.bootTimer !== null) {
			window.clearTimeout(this.bootTimer);
			this.bootTimer = null;
		}
		if (this.tickInterval !== null) {
			window.clearInterval(this.tickInterval);
			this.tickInterval = null;
		}
		for (const controller of this.running.values()) controller.abort();
	}

	/** True while a run of this job is in flight (drives the settings card). */
	isRunning(jobId: string): boolean {
		return this.running.has(jobId);
	}

	/** Fire every due job. Errors are contained per job — one broken job
	 *  (corrupt schedule, throwing write) must not starve the others. */
	private async tick(): Promise<void> {
		if (this.stopped) return;
		const now = Date.now();
		for (const job of this.plugin.settings.scheduledJobs) {
			try {
				if (!job.enabled || this.running.has(job.id)) continue;
				if (!isJobDue(job, now)) continue;
				void this.runJob(job, 'schedule');
			} catch (e) {
				console.warn(`[Curtis] Scheduled-run check failed for "${job.name}":`, e);
			}
		}
	}

	/** Manual "Run now" from the settings card. A manual run is a real fire:
	 *  it updates lastFiredAt like a scheduled one, so it resets the
	 *  interval window and marks today's daily occurrence done. */
	runJobNow(jobId: string): void {
		const job = this.plugin.settings.scheduledJobs.find((j) => j.id === jobId);
		if (!job) return;
		if (this.running.has(job.id)) {
			new Notice(`"${job.name}" is already running`);
			return;
		}
		void this.runJob(job, 'manual');
	}

	/** One headless run: fire the prompt (through the named agent when set),
	 *  write a run note either way, and record the attempt on the job. */
	private async runJob(job: ScheduledJob, trigger: 'schedule' | 'manual'): Promise<void> {
		const startedAt = Date.now();
		// Mark the attempt BEFORE running: lastFiredAt is "fired", not
		// "succeeded" — a crash mid-run must not turn into a re-fire loop.
		job.lastFiredAt = startedAt;
		await this.persist();

		const controller = new AbortController();
		this.running.set(job.id, controller);
		let output = '';
		let error: Error | undefined;
		try {
			if (!this.plugin.api) throw new Error('Curtis API unavailable');
			const options = { signal: controller.signal };
			output = job.agentName
				? await this.plugin.api.runAgent(job.agentName, job.prompt, options)
				: await this.plugin.api.chat(job.prompt, options);
		} catch (e) {
			error = e instanceof Error ? e : new Error(String(e));
		} finally {
			this.running.delete(job.id);
		}

		const durationMs = Date.now() - startedAt;
		const aborted = controller.signal.aborted;

		// The settings entry may have been deleted mid-run — the run note is
		// still written, but only a surviving job gets bookkeeping persisted.
		const survivor = this.plugin.settings.scheduledJobs.find((j) => j.id === job.id);
		if (survivor) {
			survivor.lastDurationMs = durationMs;
			if (aborted) {
				survivor.lastStatus = 'error';
				survivor.lastError = 'Aborted (Curtis reloaded)';
			} else if (error) {
				survivor.lastStatus = 'error';
				survivor.lastError = error.message;
			} else {
				survivor.lastStatus = 'ok';
				survivor.lastError = undefined;
			}
		}

		if (aborted) {
			// Plugin unloading — skip the note and the notices, persist quietly.
			if (survivor) await this.persist();
			return;
		}

		const path = await this.writeRunNote(job, trigger, startedAt, durationMs, output, error);
		if (survivor) {
			survivor.lastRunPath = path ?? undefined;
			await this.persist();
		}

		const label = job.agentName ? `${job.name} (${job.agentName})` : job.name;
		if (error) {
			console.warn(`[Curtis] Scheduled run "${job.name}" failed:`, error);
			new Notice(`Scheduled run "${label}" failed: ${error.message}`, 8000);
		} else {
			new Notice(`Scheduled run "${label}" finished${path ? ` — saved to ${path}` : ''}`, 6000);
		}
	}

	/** One note per run: frontmatter carries the job identity and outcome,
	 *  the body is the answer (or the error). Failures write a note too —
	 *  the note, not a toast, is the audit trail. */
	private async writeRunNote(
		job: ScheduledJob,
		trigger: 'schedule' | 'manual',
		startedAt: number,
		durationMs: number,
		output: string,
		error: Error | undefined
	): Promise<string | null> {
		const folder = this.plugin.settings.scheduledOutputFolder.trim() || 'AI/Scheduled';
		const stamp = formatStamp(startedAt);
		const file = await createNote(this.plugin.app, folder, `${job.name} ${stamp}`, error ? failureBody(job, error) : successBody(output), {
			frontmatter: {
				curtis: 'scheduled-run',
				job: job.name,
				job_id: job.id,
				agent: job.agentName || 'default assistant',
				trigger,
				schedule: describeSchedule(job.schedule),
				status: error ? 'error' : 'ok',
				ran_at: new Date(startedAt).toISOString(),
				duration_ms: durationMs,
			},
		});
		return file?.path ?? null;
	}

	private async persist(): Promise<void> {
		try {
			await this.plugin.saveSettings();
		} catch (e) {
			console.warn('[Curtis] Scheduled runs: could not persist job state:', e);
		}
	}
}

/** Local-time stamp for note basenames — 'YYYY-MM-DD HH-mm' (colons are
 *  invalid in Obsidian basenames; locale strings are not portable). */
function formatStamp(epochMs: number): string {
	const d = new Date(epochMs);
	const p = (n: number): string => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
}

function successBody(output: string): string {
	return output.trim() || '*(The run completed but returned no text.)*';
}

function failureBody(job: ScheduledJob, error: Error): string {
	return [
		'**The run failed.**',
		'',
		`> ${error.message.replace(/\n/g, ' ')}`,
		'',
		'---',
		'',
		'**Task** (re-run this from Settings → Curtis AI → Scheduled runs → Run now):',
		'',
		job.prompt,
	].join('\n');
}
