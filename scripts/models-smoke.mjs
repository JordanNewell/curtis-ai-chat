// Model-discovery smoke test orchestrator.
//
// Bundles scripts/models-smoke-entry.ts (which drives the REAL registry code
// from src/providers/) with the obsidian module stubbed to a fake in-process
// network, runs it, and reports the result.
//
// Usage:  node scripts/models-smoke.mjs
// Needs:  node >= 18. Not shipped in the plugin bundle.

import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

async function main() {
	const outDir = mkdtempSync(join(tmpdir(), 'curtis-models-smoke-'));
	const outfile = join(outDir, 'smoke.cjs');
	try {
		await build({
			entryPoints: [join(root, 'scripts', 'models-smoke-entry.ts')],
			bundle: true,
			platform: 'node',
			format: 'cjs',
			outfile,
			alias: { obsidian: join(root, 'scripts', 'obsidian-stub-models.ts') },
			logLevel: 'silent',
		});
		const code = await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [outfile], { stdio: 'inherit' });
			child.on('error', reject);
			child.on('exit', (c) => resolve(c ?? 1));
		});
		process.exitCode = code;
	} finally {
		rmSync(outDir, { recursive: true, force: true });
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
