// Live smoke test for the 2.0 provider seed refresh: one minimal
// chat-completions call per provider, plus /models checks that every
// curated seed id still exists in the provider's catalog. Keys come from
// env and are never printed. Costs a fraction of a cent per run.
//
// Usage: node scripts/smoke-providers.mjs [providerId ...]

const CHAT = {
	openai: { url: 'https://api.openai.com/v1/chat/completions', key: 'OPENAI_API_KEY', model: 'gpt-6-luna' },
	xai: { url: 'https://api.x.ai/v1/chat/completions', key: 'XAI_API_KEY', model: 'grok-4.3' },
	mistral: { url: 'https://api.mistral.ai/v1/chat/completions', key: 'MISTRAL_API_KEY', model: 'mistral-small-4-0-26-03' },
	perplexity: { url: 'https://api.perplexity.ai/chat/completions', key: 'PERPLEXITY_API_KEY', model: 'sonar' },
	google: { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: 'GOOGLE_API_KEY', model: 'gemini-3.8-flash' },
	meta: { url: 'https://api.meta.ai/v1/chat/completions', key: 'META_API_KEY', model: 'muse-spark-1.1' },
};

const MODELS = {
	openai: { url: 'https://api.openai.com/v1/models', key: 'OPENAI_API_KEY', expect: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'] },
	xai: { url: 'https://api.x.ai/v1/models', key: 'XAI_API_KEY', expect: ['grok-4.7', 'grok-4.6', 'grok-4.3', 'grok-build-0.1'] },
};

const TIMEOUT_MS = 45_000;

async function chat(id, def) {
	const key = process.env[def.key];
	if (!key) return `${'SKIP'.padEnd(4)} ${id.padEnd(11)} no ${def.key} in env`;
	const started = Date.now();
	try {
		const resp = await fetch(def.url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
			body: JSON.stringify({
				model: def.model,
				messages: [{ role: 'user', content: 'Reply with the single word ok.' }],
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		const ms = Date.now() - started;
		const body = await resp.json().catch(() => ({}));
		if (!resp.ok) {
			const detail = body?.error?.message || JSON.stringify(body).slice(0, 160);
			return `${'FAIL'.padEnd(4)} ${id.padEnd(11)} ${def.model} → HTTP ${resp.status} ${String(detail).slice(0, 140)}`;
		}
		const text = (body?.choices?.[0]?.message?.content ?? '').replace(/\s+/g, ' ').trim();
		const usage = body?.usage ? ` in=${body.usage.prompt_tokens} out=${body.usage.completion_tokens}` : '';
		return `${'PASS'.padEnd(4)} ${id.padEnd(11)} ${def.model} ${ms}ms${usage} "${text.slice(0, 60)}"`;
	} catch (e) {
		return `${'FAIL'.padEnd(4)} ${id.padEnd(11)} ${def.model} → ${e.name === 'TimeoutError' ? `timeout after ${TIMEOUT_MS}ms` : e.message}`;
	}
}

async function models(id, def) {
	const key = process.env[def.key];
	if (!key) return `${'SKIP'.padEnd(4)} ${id}/models no ${def.key} in env`;
	try {
		const resp = await fetch(def.url, {
			headers: { Authorization: `Bearer ${key}` },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!resp.ok) return `${'FAIL'.padEnd(4)} ${id}/models HTTP ${resp.status}`;
		const body = await resp.json().catch(() => ({}));
		const listed = new Set((body?.data ?? []).map((m) => m.id));
		const missing = def.expect.filter((mid) => !listed.has(mid));
		return missing.length === 0
			? `${'PASS'.padEnd(4)} ${id}/models all ${def.expect.length} seed ids listed`
			: `${'WARN'.padEnd(4)} ${id}/models not listed: ${missing.join(', ')} (chat may still route them)`;
	} catch (e) {
		return `${'FAIL'.padEnd(4)} ${id}/models ${e.message}`;
	}
}

const filter = process.argv.slice(2);
const targets = filter.length ? filter : Object.keys(CHAT);
for (const id of targets) {
	if (!CHAT[id] && !MODELS[id]) {
		console.log(`SKIP ${id.padEnd(11)} unknown provider id`);
		continue;
	}
	if (MODELS[id]) console.log(await models(id, MODELS[id]));
	if (CHAT[id]) console.log(await chat(id, CHAT[id]));
}
