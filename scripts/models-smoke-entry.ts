// Model-discovery smoke test entry — bundled with esbuild (obsidian → stub
// with a fake in-process network) and run under node by models-smoke.mjs.
//
// Exercises the real registry code path: /models URL derivation per auth type
// (bearer vs anthropic, incl. the anthropic-version header), merge semantics
// (discovered ids first with known metadata kept, curated ids NEVER pruned,
// manual extras appended bare), prune semantics (only ids that came from an
// earlier discovery and vanished from today's listing are dropped; a failed
// discovery prunes nothing and never touches the persisted cache), restart
// seeding from the persisted cache with zero network, no mutation of shared
// def.models arrays, and removeCustomProvider's keepDiscoveredCache flag.

import { strict as assert } from 'node:assert/strict';
import { ProviderRegistry, PROVIDER_DEFINITIONS } from '../src/providers/registry';
import type { AIModel, ProviderConfig, ProviderDefinition } from '../src/types';
import { __setRequestRouter, requestsSeen } from './obsidian-stub-models';

// --- fixture: one custom OpenAI-compat provider -----------------------------

const FAKE_DEF: ProviderDefinition = {
	id: 'fake-openai',
	name: 'Fake OpenAI',
	endpoint: 'http://models.test/v1/chat/completions',
	authType: 'bearer',
	autoDiscoverModels: true,
	models: [
		{ id: 'curated-keep', name: 'Curated Keep', contextLength: 8192, inputPrice: 1, outputPrice: 2 },
		{ id: 'curated-gone', name: 'Curated Gone', contextLength: 4096, inputPrice: 3, outputPrice: 4 },
	],
};
const FAKE_CFG: ProviderConfig = { enabled: true, apiKey: 'sk-test', extraModels: ['extra-manual'] };
const FAKE_MODELS_URL = 'http://models.test/v1/models';

/** Router that serves the fake provider's listing (or a 500) and 404s
 *  everything else — including the real Anthropic def, which initializeProviders
 *  always constructs and now always tries to discover. */
function routerFor(listing: string[] | 'fail'): void {
	__setRequestRouter((req) => {
		if (req.url !== FAKE_MODELS_URL) return { status: 404 };
		if (listing === 'fail') return { status: 500 };
		return { status: 200, json: { data: listing.map((id) => ({ id })) } };
	});
}

const idList = (models: AIModel[]) => models.map((m) => m.id).join(',');

async function main(): Promise<void> {
	// --- boot: merge order, metadata, headers, persistence hook ------------

	routerFor(['discovered-a', 'curated-keep']);
	const persisted: Record<string, AIModel[]> = {};
	let persistedWrites = 0;
	const registry = new ProviderRegistry(
		{ 'fake-openai': FAKE_CFG },
		[FAKE_DEF],
		(_id, config) => config?.apiKey || '',
		undefined,
		(id, models) => {
			persisted[id] = models;
			persistedWrites++;
		}
	);
	await registry.initializeProviders();

	let fake = registry.getProvider("fake-openai")!;
	assert.ok(fake, 'fake provider constructed');
	assert.equal(
		idList(fake.models),
		'discovered-a,curated-keep,curated-gone,extra-manual',
		'merge: discovered first, curated kept, extras appended'
	);
	assert.equal(fake.models.find((m) => m.id === 'curated-keep')?.inputPrice, 1, 'baked-in metadata kept for discovered ids');
	assert.equal(fake.models.find((m) => m.id === 'discovered-a')?.inputPrice, 0, 'newly discovered ids land with default metadata');
	const extra = fake.models.find((m) => m.id === 'extra-manual');
	assert.ok(extra && extra.contextLength === 0 && extra.name === 'extra-manual', 'manual extras land as bare entries');
	const fakeReq = requestsSeen.find((r) => r.url === FAKE_MODELS_URL);
	assert.equal(fakeReq?.headers?.['Authorization'], 'Bearer sk-test', 'bearer discovery sends Authorization');
	assert.equal(persisted['fake-openai']?.length, 4, 'onModelsDiscovered fires with the merged list');
	assert.equal(FAKE_DEF.models.length, 2, 'shared def.models array never mutated by seeding/merging');

	// --- prune: vanished discovery-only ids go, curated + manual stay -------

	routerFor(['curated-keep']);
	await registry.discoverModels(FAKE_DEF);
	fake = registry.getProvider("fake-openai")!;
	assert.equal(
		idList(fake.models),
		'curated-keep,curated-gone,extra-manual',
		'prune: vanished discovery-only id dropped; curated + manual survive'
	);

	// --- discovery failure: list and cache untouched ------------------------

	routerFor('fail');
	const writesBefore = persistedWrites;
	const listBefore = idList(registry.getProvider("fake-openai")!.models);
	const failed = await registry.discoverModels(FAKE_DEF);
	assert.equal(failed.length, 0, 'failed discovery returns an empty list');
	assert.equal(idList(registry.getProvider("fake-openai")!.models), listBefore, 'failed discovery leaves the model list intact');
	assert.equal(persistedWrites, writesBefore, 'failed discovery does not touch the persisted cache');

	// --- anthropic: URL derivation + auth headers ---------------------------

	const ANTHROPIC_URL = 'https://api.anthropic.com/v1/models?limit=1000';
	__setRequestRouter((req) => {
		if (req.url !== ANTHROPIC_URL) return { status: 404 };
		return { status: 200, json: { data: [{ id: 'claude-smoke-1', display_name: 'Claude Smoke' }] } };
	});
	const registryA = new ProviderRegistry({ anthropic: { enabled: true, apiKey: 'ak-test' } }, [], () => 'ak-test');
	await registryA.initializeProviders();
	// requestsSeen accumulates across registries — the earlier registry's
	// headerless configless-anthropic attempt shares this URL; assert on the
	// latest request for it.
	const aReq = requestsSeen.filter((r) => r.url === ANTHROPIC_URL).pop();
	assert.ok(aReq, `anthropic models URL derived from chat endpoint (${ANTHROPIC_URL})`);
	assert.equal(aReq?.headers?.['x-api-key'], 'ak-test', 'anthropic discovery sends x-api-key');
	assert.equal(aReq?.headers?.['anthropic-version'], '2023-06-01', 'anthropic discovery sends anthropic-version');
	const aModels = registryA.getProvider("anthropic")!.models;
	const bakedAnthropic = PROVIDER_DEFINITIONS.find((d) => d.authType === 'anthropic');
	assert.ok(bakedAnthropic, 'anthropic def exists in PROVIDER_DEFINITIONS');
	assert.ok(
		bakedAnthropic.models.every((m) => aModels.some((x) => x.id === m.id)),
		'anthropic baked-in ids never pruned by a thin listing'
	);
	assert.ok(aModels.some((m) => m.id === 'claude-smoke-1'), 'anthropic newly discovered id appears');

	// --- restart seeding: persisted cache + extras, zero network -----------

	const CACHE_WITH_EXTRA: AIModel[] = [
		{ id: 'cache-a', name: 'Cache A', contextLength: 1000, inputPrice: 0, outputPrice: 0 },
		{ id: 'extra-manual', name: 'Extra With Metadata', contextLength: 2000, inputPrice: 0, outputPrice: 0 },
	];
	const registry2 = new ProviderRegistry(
		{ 'fake-openai': FAKE_CFG },
		[FAKE_DEF],
		(_id, c) => c?.apiKey || '',
		{ 'fake-openai': CACHE_WITH_EXTRA }
	);
	const seenBefore = requestsSeen.length;
	registry2.updateConfig('fake-openai', FAKE_CFG); // reconstructs the provider
	const seeded = registry2.getProvider("fake-openai")!.models;
	assert.equal(idList(seeded), 'cache-a,extra-manual', 'restart seeds from persisted cache + extras');
	assert.equal(seeded.find((m) => m.id === 'extra-manual')?.name, 'Extra With Metadata', 'extra already in cache deduped, metadata kept');
	assert.equal(requestsSeen.length, seenBefore, 'reconstruction makes no network calls');

	const registry3 = new ProviderRegistry(
		{ 'fake-openai': FAKE_CFG },
		[FAKE_DEF],
		(_id, c) => c?.apiKey || '',
		{ 'fake-openai': [CACHE_WITH_EXTRA[0]] } // cache WITHOUT the extra
	);
	registry3.updateConfig('fake-openai', FAKE_CFG);
	const seeded3 = registry3.getProvider("fake-openai")!.models;
	assert.equal(idList(seeded3), 'cache-a,extra-manual', 'extra missing from cache appended');
	assert.equal(seeded3.find((m) => m.id === 'extra-manual')?.contextLength, 0, 'extra missing from cache appended bare');

	// --- removeCustomProvider: edit-save keeps the cache, delete clears it --

	registry3.removeCustomProvider('fake-openai', true); // settings edit-save path
	registry3.addCustomProvider(FAKE_DEF);
	registry3.updateConfig('fake-openai', FAKE_CFG);
	assert.ok(
		registry3.getProvider('fake-openai')!.models.some((m) => m.id === 'cache-a'),
		'edit-save (keepDiscoveredCache) preserves the discovery cache'
	);

	registry3.removeCustomProvider('fake-openai'); // hard delete
	registry3.addCustomProvider(FAKE_DEF);
	registry3.updateConfig('fake-openai', FAKE_CFG);
	assert.ok(
		!registry3.getProvider('fake-openai')!.models.some((m) => m.id === 'cache-a'),
		'hard delete clears the discovery cache'
	);

	console.log('models smoke test: all assertions passed');
}

main().catch((e) => {
	console.error('models smoke test FAILED:', e);
	process.exit(1);
});
