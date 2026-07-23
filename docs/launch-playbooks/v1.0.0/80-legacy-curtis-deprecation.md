# Legacy `curtis` listing — deprecation update

**Use:** Text to update the existing community.obsidian.md/plugins/curtis listing so v3.0.1 users find curtis-ai-chat as the successor. The old listing stays live (existing users auto-update from it); only the description changes.

**Context:** Plugin ID changed `curtis` → `curtis-ai-chat`. The old listing cannot be deleted (users have it installed), but its description should redirect to the new plugin.

---

## Short manifest description (~200 chars)

For the curtis-chat repo's `manifest.json` `description` field. Requires a v3.0.2 patch release to land — auto-update delivers the deprecation notice to existing curtis users.

```
Superseded by curtis-ai-chat (community.obsidian.md/plugins/curtis-ai-chat). Install the new plugin instead — v1.0 is the active line. This v3 stays for existing installs only; no new features.
```

---

## Long page body (~650 chars)

For the community.obsidian.md dashboard's long-description field on the curtis listing (if the dashboard allows editing without a new release — verify first). Otherwise bundle into the v3.0.2 release notes.

```
⚠️ **Deprecated — install curtis-ai-chat instead.**

This plugin (plugin ID `curtis`) is superseded by **curtis-ai-chat** as of 2026-07-23. The new plugin is a clean rebrand with agent mode, multi-model arena, voice I/O, inline diff rewrite, @-mention vault notes, cross-conversation search, and more.

→ Install from `community.obsidian.md/plugins/curtis-ai-chat`

Existing v3 installs continue to work. Conversation history does not auto-migrate (different plugin ID); API keys are stored per-provider in the OS keychain so they will need to be re-entered once under the new plugin's settings.

This listing will not receive further updates.
```

---

## Deployment paths

**Path A — dashboard edit only (no release):**
1. Visit `community.obsidian.md/account/plugins/curtis`
2. If the dashboard exposes a description field, paste the long page body
3. Done — no release needed, no auto-update churn

**Path B — v3.0.2 patch release:**
1. In the curtis-chat repo, bump `manifest.json` version to `3.0.2` + description to the short blurb above
2. Bump `versions.json` to add `"3.0.2": "1.11.4"`
3. Commit + tag `3.0.2` (no `v` prefix per Obsidian rule)
4. Push tag → existing curtis auto-update installs pick up v3.0.2 and show the deprecation description in their plugin list
5. Also update the dashboard long description with the body text

Path B is more thorough (every installed user sees the notice in their plugins list, not just on the directory page) but requires a release. Path A is fast if the dashboard supports it.

**Recommendation:** try Path A first. If the dashboard doesn't allow description edits without a release, fall back to Path B.
