// GCP connector smoke test orchestrator.
//
// Starts a local server on 127.0.0.1 that plays Google: an OAuth2 token
// endpoint that VERIFIES the client's service-account JWT (real RS256
// verification with node crypto) and a Cloud Storage JSON API. Bundles
// scripts/gcp-smoke-entry.ts (which drives the REAL GcpManager from
// src/gcp/) with the obsidian module stubbed, runs it, reports the result.
//
// The service-account key handed to the manager is generated here, so its
// token_uri points at the local token endpoint — no request leaves the
// machine, but the signing path is the real one.
//
// Usage:  node scripts/gcp-smoke.mjs
// Needs:  node >= 18. Not shipped in the plugin bundle.

import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

// ---------------------------------------------------------------------------
// Fake Google: token endpoint + Cloud Storage JSON API
// ---------------------------------------------------------------------------

const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

/** Assigned in main() once the server is listening; the handlers below read it. */
let port = 0;

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

/** Generation counter — /__expire bumps it, which 401s every older token. */
let tokenGeneration = 0;
let nextTokenId = 0;
/** access_token → generation it was minted in. */
const issuedTokens = new Map();
/** Recorded Storage-API requests: { path, query, authorization }. */
const storageRequests = [];

function jsonResp(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

function b64UrlJson(segment) {
	return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function verifyJwt(assertion) {
	const parts = assertion.split('.');
	if (parts.length !== 3) return { ok: false, reason: 'assertion is not a 3-segment JWT' };
	let header;
	let claims;
	try {
		header = b64UrlJson(parts[0]);
		claims = b64UrlJson(parts[1]);
	} catch {
		return { ok: false, reason: 'assertion segments are not base64url JSON' };
	}
	if (header.alg !== 'RS256' || header.typ !== 'JWT') {
		return { ok: false, reason: `unexpected header ${JSON.stringify(header)}` };
	}
	const sigOk = cryptoVerify(
		'sha256',
		Buffer.from(`${parts[0]}.${parts[1]}`),
		publicKey,
		Buffer.from(parts[2], 'base64url'),
	);
	if (!sigOk) return { ok: false, reason: 'RS256 signature does not verify' };
	return { ok: true, claims };
}

const server = createServer((req, res) => {
	let raw = '';
	req.on('data', (chunk) => (raw += chunk));
	req.on('end', () => {
		const url = new URL(req.url || '/', 'http://127.0.0.1');

		// ---- control endpoints (no auth — used by the test itself) ----
		if (url.pathname === '/__expire') {
			tokenGeneration++;
			res.writeHead(200).end();
			return;
		}
		if (url.pathname === '/__requests') {
			jsonResp(res, 200, { requests: storageRequests });
			return;
		}

		// ---- OAuth2 token endpoint (the key's token_uri) ----
		if (url.pathname === '/token') {
			const form = new URLSearchParams(raw);
			const assertion = form.get('assertion') ?? '';
			if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
				jsonResp(res, 400, { error: 'unsupported_grant_type', error_description: 'grant_type must be jwt-bearer' });
				return;
			}
			const verdict = verifyJwt(assertion);
			if (!verdict.ok) {
				jsonResp(res, 400, { error: 'invalid_grant', error_description: verdict.reason });
				return;
			}
			const claims = verdict.claims;
			if (claims.iss !== 'curtis-smoke@smoke-project.iam.gserviceaccount.com'
				|| claims.aud !== `http://127.0.0.1:${port}/token`
				|| claims.scope !== SCOPE
				|| typeof claims.exp !== 'number' || claims.exp <= (claims.iat ?? 0)) {
				jsonResp(res, 400, { error: 'invalid_grant', error_description: `bad claims: ${JSON.stringify(claims)}` });
				return;
			}
			const accessToken = `tok-gen${tokenGeneration}-${++nextTokenId}`;
			issuedTokens.set(accessToken, tokenGeneration);
			jsonResp(res, 200, { access_token: accessToken, expires_in: 3600, token_type: 'Bearer' });
			return;
		}

		// ---- Cloud Storage JSON API ----
		const authorization = req.headers['authorization'] ?? '';
		const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
		const tokenGenerationOk = issuedTokens.get(token) === tokenGeneration;
		storageRequests.push({
			path: decodeURIComponent(url.pathname),
			query: Object.fromEntries(url.searchParams.entries()),
			authorization,
		});
		if (!token || !issuedTokens.has(token) || !tokenGenerationOk) {
			jsonResp(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
			return;
		}

		const sendJson = (status, body) => jsonResp(res, status, body);

		// Bucket listing: GET /storage/v1/b?project=…&maxResults=…
		if (url.pathname === '/storage/v1/b') {
			if (url.searchParams.get('project') !== 'smoke-project') {
				sendJson(400, { error: { code: 400, message: `unknown project ${url.searchParams.get('project')}` } });
				return;
			}
			sendJson(200, {
				items: [{ name: 'smoke-bucket', location: 'US' }, { name: 'smoke-media', location: 'EU' }],
			});
			return;
		}

		// Object listing: GET /storage/v1/b/<bucket>/o?prefix=…
		const listMatch = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)\/o$/);
		if (listMatch) {
			const prefix = url.searchParams.get('prefix') ?? '';
			const all = [
				{ name: 'reports/2026/q1.csv', size: '21', contentType: 'text/csv' },
				{ name: 'reports/2026/summary.json', size: '512', contentType: 'application/json' },
				{ name: 'media/pic.png', size: '4096', contentType: 'image/png' },
			].filter((o) => o.name.startsWith(prefix));
			sendJson(200, { items: all });
			return;
		}

		// Object metadata: GET /storage/v1/b/<bucket>/o/<object>
		// url.pathname keeps percent-encoding (the client sends %2F, as
		// Google requires) — decode before matching object names.
		const metaMatch = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)\/o\/(.+)$/);
		if (metaMatch && !url.searchParams.has('alt')) {
			const object = decodeURIComponent(metaMatch[2]);
			if (object === 'reports/q1.csv') {
				sendJson(200, { name: object, contentType: 'text/csv', size: '21' });
			} else if (object === 'media/pic.png') {
				sendJson(200, { name: object, contentType: 'image/png', size: '4096' });
			} else {
				sendJson(404, { error: { code: 404, message: `No such object: ${metaMatch[1]}/${object}` } });
			}
			return;
		}

		// Media download: GET /download/storage/v1/b/<bucket>/o/<object>?alt=media
		const mediaMatch = url.pathname.match(/^\/download\/storage\/v1\/b\/([^/]+)\/o\/(.+)$/);
		if (mediaMatch && url.searchParams.get('alt') === 'media') {
			const object = decodeURIComponent(mediaMatch[2]);
			if (object === 'reports/q1.csv') {
				res.writeHead(200, { 'Content-Type': 'text/csv' });
				res.end('quarter 1 looks great');
			} else {
				sendJson(404, { error: { code: 404, message: `No such object: ${mediaMatch[1]}/${object}` } });
			}
			return;
		}

		sendJson(404, { error: { code: 404, message: `no fake-Google route: ${url.pathname}` } });
	});
});

// ---------------------------------------------------------------------------
// Bundle + run the entry against the fake Google
// ---------------------------------------------------------------------------

async function main() {
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	port = server.address().port;

	// The service-account key the REAL manager will parse and sign with.
	const serviceAccount = {
		type: 'service_account',
		project_id: 'smoke-project',
		private_key_id: 'smoke-key-id',
		private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
		client_email: 'curtis-smoke@smoke-project.iam.gserviceaccount.com',
		token_uri: `http://127.0.0.1:${port}/token`,
	};

	const outDir = mkdtempSync(join(tmpdir(), 'curtis-gcp-smoke-'));
	const outfile = join(outDir, 'smoke.cjs');
	try {
		await build({
			entryPoints: [join(root, 'scripts', 'gcp-smoke-entry.ts')],
			bundle: true,
			platform: 'node',
			format: 'cjs',
			outfile,
			alias: { obsidian: join(root, 'scripts', 'obsidian-stub.ts') },
			logLevel: 'silent',
		});
		const code = await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [outfile], {
				env: {
					...process.env,
					GCP_SMOKE_PORT: String(port),
					GCP_SMOKE_SA: Buffer.from(JSON.stringify(serviceAccount)).toString('base64'),
				},
				stdio: 'inherit',
			});
			child.on('error', reject);
			child.on('exit', (c) => resolve(c ?? 1));
		});
		process.exitCode = code;
	} finally {
		rmSync(outDir, { recursive: true, force: true });
		server.close();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
