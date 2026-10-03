// Curtis — RAG rebuild UX: shared by the settings button and the command
// palette. One persistent Notice whose message tracks chunk progress.

import { Notice } from 'obsidian';
import type CurtisPlugin from '../main';

export async function rebuildIndexWithProgress(plugin: CurtisPlugin): Promise<void> {
	const status = plugin.ragIndex.getStatus();
	if (status.building) {
		new Notice('Curtis: index build already running');
		return;
	}
	const notice = new Notice('Curtis: preparing vault index…', 0);
	try {
		await plugin.ragIndex.rebuildAll((done, total) => {
			if (total > 0) notice.setMessage(`Curtis: indexing vault… ${done}/${total} chunks`);
		});
		const st = plugin.ragIndex.getStatus();
		notice.setMessage(`Curtis: index built — ${st.fileCount} notes, ${st.chunkCount} chunks`);
		window.setTimeout(() => notice.hide(), 4000);
	} catch (e) {
		notice.setMessage(`Curtis: indexing failed — ${(e as Error).message}`);
		window.setTimeout(() => notice.hide(), 8000);
	}
}
