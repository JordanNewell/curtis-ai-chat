/** Brand color per built-in provider id. Used for the role/picker dot.
 *  Custom providers fall back to --interactive-accent via CSS. */
const PROVIDER_COLORS: Record<string, string> = {
	anthropic: '#d97757',
	openai: '#10a37f',
	gemini: '#4285f4',
	'zai-glm': '#3b82f6',
	ollama: '#9333ea',
	openrouter: '#6464ff',
	mistral: '#fa520f',
	groq: '#f55036',
	deepseek: '#4d6bfe',
	meta: '#0081FB',
	xai: '#ffffff',
	perplexity: '#20808d',
	novita: '#00d4aa',
	deepinfra: '#ff6b35',
	chutes: '#facc15',
	replicate: '#000000',
	huggingface: '#ff9d00',
	'azure-openai': '#0078d4',
	fal: '#7c3aed',
	cerebras: '#e63946',
	sambanova: '#1e88e5',
	requesty: '#22c55e',
	// 2026-10-10 batch
	zai: '#3b82f6',
	modelark: '#3370ff',
	qianfan: '#2932e1',
	siliconflow: '#22d3ee',
	crusoe: '#0d9488',
	poe: '#6c5ce7',
	featherless: '#38bdf8',
	scaleway: '#5100cd',
	reka: '#f97316',
};

export function providerColor(providerId: string | undefined): string | undefined {
	if (!providerId) return undefined;
	// Direct hit
	if (PROVIDER_COLORS[providerId]) return PROVIDER_COLORS[providerId];
	// Partial match (e.g. custom providers with prefixed ids)
	const lower = providerId.toLowerCase();
	for (const key of Object.keys(PROVIDER_COLORS)) {
		if (lower.includes(key)) return PROVIDER_COLORS[key];
	}
	return undefined;
}
