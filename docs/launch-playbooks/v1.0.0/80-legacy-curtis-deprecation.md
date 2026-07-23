# Legacy `curtis` listing — deprecation + archive

**Status:** ✅ Applied 2026-07-23. Long page body pasted into the dashboard; listing archived.

**Use:** Reference for what was done to community.obsidian.md/plugins/curtis to redirect v3.0.1 users to curtis-ai-chat. Kept as a template for any future plugin successor launches.

**Context:** Plugin ID changed `curtis` → `curtis-ai-chat`. The old listing cannot be deleted (users have it installed). Deprecation text + archiving is the cleanest combination: search-hidden from new users, page still loads for existing users with clear redirect.

---

## What was applied

1. **Long description updated** on `community.obsidian.md/plugins/curtis` with the deprecation body below.
2. **Listing archived** via the dashboard. Effect: hidden from "Browse" search; direct URL still works; existing installs keep functioning; auto-update from curtis-chat releases still works.

---

## Long page body (~650 chars)

```
⚠️ **Deprecated — install curtis-ai-chat instead.**

This plugin (plugin ID `curtis`) is superseded by **curtis-ai-chat** as of 2026-07-23. The new plugin is a clean rebrand with agent mode, multi-model arena, voice I/O, inline diff rewrite, @-mention vault notes, cross-conversation search, and more.

→ Install from `community.obsidian.md/plugins/curtis-ai-chat`

Existing v3 installs continue to work. Conversation history does not auto-migrate (different plugin ID); API keys are stored per-provider in the OS keychain so they will need to be re-entered once under the new plugin's settings.

This listing will not receive further updates.
```

---

## Optional follow-up: v3.0.2 patch release

If you want every installed v3 user to see the deprecation notice in their Obsidian plugins list (not just the directory page), ship a v3.0.2 patch release of curtis-chat with the short blurb as the manifest description:

```
Superseded by curtis-ai-chat (community.obsidian.md/plugins/curtis-ai-chat). Install the new plugin instead — v1.0 is the active line. This v3 stays for existing installs only; no new features.
```

Steps:
1. In curtis-chat repo, bump `manifest.json` version → `3.0.2`, description → short blurb above
2. Bump `versions.json` to add `"3.0.2": "1.11.4"`
3. Commit + tag `3.0.2` (no `v` prefix)
4. Push tag → curtis-chat release.yml publishes assets, Obsidian auto-update delivers v3.0.2 with deprecation text to installed users

Not required — the archive + dashboard description handles the funnel side. v3.0.2 is only worth it if you want maximum in-product visibility for existing users.

---

## Why archive + deprecation > deprecation alone

| Approach | New users find curtis? | Existing users see notice? | Risk |
|----------|------------------------|----------------------------|------|
| Do nothing | Yes (in search) | No | Confusion |
| Update description only | Yes (in search) | Only if they visit page | Mild confusion |
| **Archive + deprecation text** | **No (search-hidden)** | **Yes (page + archived badge)** | **None — reversible** |

Archiving is reversible via the dashboard if curtis-ai-chat submission ever needs to be backed out.

