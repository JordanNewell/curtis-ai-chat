# BRAT — beta plugin listing entry

**Use:** [BRAT](https://github.com/TfTHacker/obsidian42-brat) installs plugins from any GitHub repo by owner/name, so users can install Curtis AI Chat right now without waiting for directory review:

```
BRAT settings → Add Beta plugin → JordanNewell/curtis-ai-chat
```

You don't need to be added to any list for that to work. The listing below is only if you want to appear in BRAT's "discoverable betas" curated list at `TfTHacker/obsidian42-brat`.

**Decision point:** most plugin authors skip the BRAT list and just tell users the owner/repo string. The list adds discoverability but requires a PR. Recommend: skip unless you want the visibility — install-by-repo string is the standard pattern.

---

## If you do want to submit to the BRAT list

Fork `TfTHacker/obsidian42-brat`, edit `docs/README.md` (or wherever the curated beta list lives at the time — check the repo), add an entry, open a PR. Format used by other entries:

```markdown
- **[Curtis AI Chat](https://github.com/JordanNewell/curtis-ai-chat)** by [@JordanNewell](https://github.com/JordanNewell) — Polyglot AI chat with 30+ providers, agent tools, multi-model arena, voice I/O, and inline diff rewrite. MIT.
```

## Direct install instructions (for your README / social posts)

Always include this three-line recipe:

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the community plugin directory.
2. Open BRAT settings → **Add Beta plugin**.
3. Paste `JordanNewell/curtis-ai-chat` → click **Add Plugin**.
4. Enable **Curtis AI Chat** under Community plugins.

BRAT keeps the install on the latest release tag automatically.
