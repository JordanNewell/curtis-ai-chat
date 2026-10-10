// Boundary guard: @curtis/core must never import the host (obsidian, electron,
// @codemirror/*). CI runs this so the platform seam stays honest.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = /^(obsidian|electron)(\/|$)|^@codemirror\//;
const ROOT = join(import.meta.dirname, '..', 'src');
const offenders = [];

function walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) walk(p);
		else if (entry.name.endsWith('.ts')) {
			const src = readFileSync(p, 'utf8');
			const re = /(?:from|import)\s+['"]([^'"]+)['"]/g;
			let m;
			while ((m = re.exec(src))) {
				if (FORBIDDEN.test(m[1])) offenders.push(`${p}: ${m[1]}`);
			}
		}
	}
}
walk(ROOT);
if (offenders.length) {
	console.error('BOUNDARY VIOLATION — @curtis/core imports host modules:\n' + offenders.join('\n'));
	process.exit(1);
}
console.log(`boundary OK: no forbidden imports in ${ROOT}`);
