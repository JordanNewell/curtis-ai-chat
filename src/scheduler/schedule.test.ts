// Schedule-math tests — the catch-up promises docs/SCHEDULED_RUNS.md makes:
// a daily job never silently skips (late = fires on next tick), interval
// jobs re-anchor instead of stacking retroactive runs, and a job can never
// double-fire within one scheduled window.

import { describe, it, expect } from 'vitest';
import { dailyFireEpoch, describeSchedule, isJobDue, parseDailyTime } from './schedule';

/** Local-time helper — schedule math is wall-clock, tests construct
 *  wall-clock expectations with the same calendar the code sees. */
const at = (y: number, mo: number, d: number, h: number, mi = 0): number =>
	new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

describe('parseDailyTime', () => {
	it('accepts 24h times with and without leading zeros', () => {
		expect(parseDailyTime('09:00')).toEqual({ hours: 9, minutes: 0 });
		expect(parseDailyTime('9:05')).toEqual({ hours: 9, minutes: 5 });
		expect(parseDailyTime('23:59')).toEqual({ hours: 23, minutes: 59 });
		expect(parseDailyTime('00:00')).toEqual({ hours: 0, minutes: 0 });
	});

	it('rejects out-of-range and malformed times', () => {
		expect(parseDailyTime('24:00')).toBeNull();
		expect(parseDailyTime('09:60')).toBeNull();
		expect(parseDailyTime('9am')).toBeNull();
		expect(parseDailyTime('')).toBeNull();
		expect(parseDailyTime('  07:30  ')).toEqual({ hours: 7, minutes: 30 });
	});
});

describe('dailyFireEpoch', () => {
	it('lands on today at the scheduled time', () => {
		const now = at(2026, 10, 10, 14, 30);
		expect(dailyFireEpoch('09:00', now)).toBe(at(2026, 10, 10, 9, 0));
	});

	it('handles midnight and end-of-day', () => {
		const now = at(2026, 10, 10, 12, 0);
		expect(dailyFireEpoch('00:00', now)).toBe(at(2026, 10, 10, 0, 0));
		expect(dailyFireEpoch('23:59', now)).toBe(at(2026, 10, 10, 23, 59));
	});
});

describe('isJobDue — daily', () => {
	const daily = (time: string, lastFiredAt?: number): { schedule: { kind: 'daily'; time: string }; lastFiredAt?: number; createdAt: number } => ({
		schedule: { kind: 'daily', time },
		lastFiredAt,
		createdAt: at(2026, 10, 1, 12, 0),
	});

	it('fires at the scheduled time', () => {
		expect(isJobDue(daily('09:00'), at(2026, 10, 10, 9, 0))).toBe(true);
	});

	it('waits before the scheduled time', () => {
		expect(isJobDue(daily('09:00'), at(2026, 10, 10, 8, 59))).toBe(false);
	});

	it('does not re-fire later the same day', () => {
		const fired = daily('09:00', at(2026, 10, 10, 9, 0));
		expect(isJobDue(fired, at(2026, 10, 10, 17, 0))).toBe(false);
	});

	it('fires again the next day', () => {
		const fired = daily('09:00', at(2026, 10, 10, 9, 0));
		expect(isJobDue(fired, at(2026, 10, 11, 9, 0))).toBe(true);
	});

	it('catches up when the app was closed at fire time', () => {
		// Fired yesterday morning; vault reopened at 14:00 — the 09:00 run
		// must happen now, not be skipped for being late.
		const fired = daily('09:00', at(2026, 10, 9, 9, 0));
		expect(isJobDue(fired, at(2026, 10, 10, 14, 0))).toBe(true);
	});

	it('catches up after a multi-day closure — once, not per missed day', () => {
		const fired = daily('09:00', at(2026, 10, 6, 9, 0));
		expect(isJobDue(fired, at(2026, 10, 10, 11, 0))).toBe(true);
	});

	it('before today’s scheduled moment, a stale fire waits (fires tonight, not at open)', () => {
		// Daily at 23:59; last fired Oct 8; reopened Oct 10 at 00:30. Today's
		// moment hasn't come — the run happens at 23:59 tonight.
		const fired = daily('23:59', at(2026, 10, 8, 23, 59));
		expect(isJobDue(fired, at(2026, 10, 10, 0, 30))).toBe(false);
		expect(isJobDue(fired, at(2026, 10, 10, 23, 59))).toBe(true);
	});

	it('an invalid stored time is never due', () => {
		expect(isJobDue(daily('not-a-time'), at(2026, 10, 10, 12, 0))).toBe(false);
	});
});

describe('isJobDue — interval', () => {
	const interval = (minutes: number, lastFiredAt?: number, createdAt = at(2026, 10, 10, 9, 0)) => ({
		schedule: { kind: 'interval' as const, minutes },
		lastFiredAt,
		createdAt,
	});

	it('anchors on creation — a brand-new job does not fire instantly', () => {
		expect(isJobDue(interval(30), at(2026, 10, 10, 9, 15))).toBe(false);
		expect(isJobDue(interval(30), at(2026, 10, 10, 9, 30))).toBe(true);
	});

	it('fires when the elapsed time since the last attempt reaches the interval', () => {
		const job = interval(30, at(2026, 10, 10, 9, 0));
		expect(isJobDue(job, at(2026, 10, 10, 9, 29))).toBe(false);
		expect(isJobDue(job, at(2026, 10, 10, 9, 30))).toBe(true);
	});

	it('re-anchors after a missed stretch — one catch-up fire, no stacking', () => {
		// Last fired 09:00, interval 30 min, app closed until 13:00: due once.
		// After that fire, the next due moment is fire time + 30, not eight
		// retroactive runs.
		const job = interval(30, at(2026, 10, 10, 9, 0));
		const reopened = at(2026, 10, 10, 13, 0);
		expect(isJobDue(job, reopened)).toBe(true);
		const reanchored = interval(30, reopened);
		expect(isJobDue(reanchored, at(2026, 10, 10, 13, 29))).toBe(false);
		expect(isJobDue(reanchored, at(2026, 10, 10, 13, 30))).toBe(true);
	});
});

describe('describeSchedule', () => {
	it('renders the daily time', () => {
		expect(describeSchedule({ kind: 'daily', time: '09:00' })).toBe('Daily at 09:00');
	});

	it('collapses round intervals to friendlier units', () => {
		expect(describeSchedule({ kind: 'interval', minutes: 30 })).toBe('Every 30 min');
		expect(describeSchedule({ kind: 'interval', minutes: 60 })).toBe('Every hour');
		expect(describeSchedule({ kind: 'interval', minutes: 720 })).toBe('Every 12 hours');
		expect(describeSchedule({ kind: 'interval', minutes: 1440 })).toBe('Every day');
		expect(describeSchedule({ kind: 'interval', minutes: 2880 })).toBe('Every 2 days');
		expect(describeSchedule({ kind: 'interval', minutes: 45 })).toBe('Every 45 min');
	});
});
