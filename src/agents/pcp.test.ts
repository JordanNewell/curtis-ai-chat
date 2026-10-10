// PCP-0 parser tests — pure functions, node-safe (no Obsidian imports).

import { describe, expect, it } from 'vitest';
import { formatClaimsBlock, normalizeClaimsPolicy, parsePcpSections } from './pcp';

describe('parsePcpSections', () => {
	it('extracts classes in file order', () => {
		const md = [
			'# Personal Context Profile',
			'',
			'## PEP-P — Personality',
			'- voice: direct',
			'',
			'## PEP-D — Developer',
			'- languages: TypeScript',
		].join('\n');
		const sections = parsePcpSections(md);
		expect(sections.map((s) => s.claimClass)).toEqual(['PEP-P', 'PEP-D']);
		expect(sections[1].body).toBe('- languages: TypeScript');
		expect(sections[1].heading).toBe('PEP-D — Developer');
	});

	it('accepts bare class headings without a label', () => {
		const sections = parsePcpSections('## PEP-H\n- sleep: 7h\n');
		expect(sections).toHaveLength(1);
		expect(sections[0].claimClass).toBe('PEP-H');
		expect(sections[0].body).toBe('- sleep: 7h');
	});

	it('normalizes class tokens to uppercase', () => {
		const sections = parsePcpSections('## pep-g — Gaming\n- genre: roguelike');
		expect(sections[0].claimClass).toBe('PEP-G');
	});

	it('never injects sections without a PEP token (default deny)', () => {
		const md = ['## Notes', '- random thought', '', '## PEP-P — Personality', '- voice: direct'].join('\n');
		const sections = parsePcpSections(md);
		expect(sections.map((s) => s.claimClass)).toEqual(['PEP-P']);
	});

	it('keeps the first section on duplicate classes', () => {
		const md = ['## PEP-P — One', '- a: 1', '', '## PEP-P — Two', '- b: 2'].join('\n');
		const sections = parsePcpSections(md);
		expect(sections).toHaveLength(1);
		expect(sections[0].body).toBe('- a: 1');
	});

	it('handles CRLF line endings', () => {
		const sections = parsePcpSections('## PEP-P — Personality\r\n- voice: direct\r\n');
		expect(sections).toHaveLength(1);
		expect(sections[0].body).toBe('- voice: direct');
	});

	it('returns empty for empty or class-less files', () => {
		expect(parsePcpSections('')).toEqual([]);
		expect(parsePcpSections('# just a title')).toEqual([]);
	});
});

describe('normalizeClaimsPolicy', () => {
	it('trims, uppercases, and dedupes', () => {
		expect(normalizeClaimsPolicy(['pep-p ', 'PEP-P', ' pep-d'])).toEqual(['PEP-P', 'PEP-D']);
	});

	it('keeps the wildcard and drops unrecognized tokens', () => {
		expect(normalizeClaimsPolicy(['*', 'bogus', 'PEP-D', '*'])).toEqual(['*', 'PEP-D']);
	});

	it('tolerates undefined and empty input', () => {
		expect(normalizeClaimsPolicy(undefined)).toEqual([]);
		expect(normalizeClaimsPolicy(['', '   '])).toEqual([]);
	});
});

describe('formatClaimsBlock', () => {
	const sections = [
		{ claimClass: 'PEP-P', heading: 'PEP-P — Personality', body: '- voice: direct' },
		{ claimClass: 'PEP-D', heading: 'PEP-D — Developer', body: '- languages: TypeScript' },
	];

	it('injects only the consented classes', () => {
		const block = formatClaimsBlock(sections, ['PEP-D']);
		expect(block).toContain('PEP-D');
		expect(block).toContain('- languages: TypeScript');
		expect(block).not.toContain('- voice: direct');
	});

	it('injects everything under the wildcard', () => {
		const block = formatClaimsBlock(sections, ['*']);
		expect(block).toContain('- voice: direct');
		expect(block).toContain('- languages: TypeScript');
	});

	it('returns null when the policy matches nothing', () => {
		expect(formatClaimsBlock(sections, ['PEP-Z'])).toBeNull();
	});

	it('labels the block as consented, not instructions', () => {
		const block = formatClaimsBlock(sections, ['*']) ?? '';
		expect(block).toContain('consented');
		expect(block).toContain('not instructions');
	});

	it('truncates runaway profiles at the cap', () => {
		const big = [
			{ claimClass: 'PEP-P', heading: 'PEP-P', body: 'x'.repeat(6_000) },
		];
		const block = formatClaimsBlock(big, ['*']) ?? '';
		expect(block.length).toBeLessThan(6_500);
		expect(block).toContain('truncated');
	});
});
