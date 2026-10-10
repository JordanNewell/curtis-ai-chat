// Schedule math for scheduled runs — pure, Obsidian-free (unit-tested under
// node). All decisions flow through isJobDue: the tick loop never does its
// own time arithmetic.
//
// Semantics (deliberate, documented in docs/SCHEDULED_RUNS.md):
//   - daily  — due once per calendar day, at/after the scheduled local time.
//     If the app was closed at fire time, the run happens on the next tick
//     after launch ("catch-up"), never skipped for being late.
//   - interval — due when the elapsed time since the last attempt (or job
//     creation, for a never-fired job) reaches the configured minutes. A
//     missed stretch re-anchors from the single catch-up fire; runs don't
//     stack up retroactively.

import type { ScheduledJobSchedule } from '../types';

/** The part of a job isJobDue needs — kept narrow so tests don't build
 *  full ScheduledJob records. */
export interface DueCheckJob {
	schedule: ScheduledJobSchedule;
	/** Epoch ms of the last fire attempt (undefined = never fired). */
	lastFiredAt?: number;
	/** Epoch ms of job creation — the initial anchor for interval jobs. */
	createdAt: number;
}

const DAILY_TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Parse 'HH:MM' (24h, leading zero optional) → components, or null. */
export function parseDailyTime(time: string): { hours: number; minutes: number } | null {
	const m = DAILY_TIME_RE.exec(time.trim());
	if (!m) return null;
	return { hours: Number(m[1]), minutes: Number(m[2]) };
}

/** Epoch ms of today's occurrence of a daily time, given `now`. */
export function dailyFireEpoch(time: string, now: number): number | null {
	const parsed = parseDailyTime(time);
	if (!parsed) return null;
	const d = new Date(now);
	d.setHours(parsed.hours, parsed.minutes, 0, 0);
	return d.getTime();
}

/** Human summary for the settings card and run notes. */
export function describeSchedule(schedule: ScheduledJobSchedule): string {
	if (schedule.kind === 'daily') return `Daily at ${schedule.time}`;
	const minutes = schedule.minutes;
	if (minutes % 1440 === 0) {
		const days = minutes / 1440;
		return days === 1 ? 'Every day' : `Every ${days} days`;
	}
	if (minutes % 60 === 0) {
		const hours = minutes / 60;
		return hours === 1 ? 'Every hour' : `Every ${hours} hours`;
	}
	return `Every ${minutes} min`;
}

/** Is this job due to fire at `now`? Pure — see the module header for the
 *  per-shape semantics. */
export function isJobDue(job: DueCheckJob, now: number): boolean {
	if (job.schedule.kind === 'daily') {
		const fireAt = dailyFireEpoch(job.schedule.time, now);
		if (fireAt === null) return false;
		// Due iff we are at/past today's moment and haven't fired since it.
		return now >= fireAt && (job.lastFiredAt ?? 0) < fireAt;
	}
	const anchor = job.lastFiredAt ?? job.createdAt;
	return now - anchor >= job.schedule.minutes * 60_000;
}
