# Contributing

PRs welcome. This doc covers dev setup, code style, and the audit every change goes through before merge.

## Dev setup

Requirements: Node 20+, Obsidian 1.11.4+, a vault for testing.

```bash
git clone https://github.com/jordannewell/obsidian-buddi.git
cd obsidian-buddi
npm install
```

### Build

```bash
npm run build      # type-check + production bundle
npm run dev        # watch mode (rebuilds on save)
```

The build writes `main.js`, `styles.css` to the repo root. Copy them (plus `manifest.json`) into your vault's `.obsidian/plugins/obsi-buddi/` folder to test:

```bash
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/obsi-buddi/
```

Then reload the plugin in Obsidian (Settings → Community plugins → toggle off/on).

### Recommended: symlink for fast iteration

```bash
ln -s /path/to/repo/main.js /path/to/vault/.obsidian/plugins/obsi-buddi/main.js
ln -s /path/to/repo/manifest.json /path/to/vault/.obsidian/plugins/obsi-buddi/manifest.json
ln -s /path/to/repo/styles.css /path/to/vault/.obsidian/plugins/obsi-buddi/styles.css
```

Now `npm run dev` rebuilds straight into the vault. Reload plugin to pick up changes.

## Project structure

```
src/
├── main.ts                # Plugin entry — onload/onunload, callAI, extractAndStoreFacts
├── settings.ts            # DEFAULT_SETTINGS + ObsiBuddiSettingTab
├── types.ts               # Shared TypeScript interfaces
├── chat/
│   ├── view.ts            # ChatView (the sidebar ItemView)
│   ├── message-renderer.ts# Markdown rendering + streaming
│   ├── message-actions.ts # Hover toolbar on assistant messages
│   ├── conversation-store.ts # Conversation/message persistence
│   └── slash-commands.ts  # /clear, /regen, /model, /memory, etc.
├── providers/
│   ├── registry.ts        # PROVIDER_DEFINITIONS + ProviderRegistry
│   ├── base.ts            # OpenAICompatibleProvider
│   ├── anthropic.ts       # AnthropicProvider (different message shape)
│   ├── transport.ts       # HTTP transport (node-https / fetch / requestUrl)
│   └── stream-shim.ts     # Adapter between Response shapes
├── memory/
│   └── memory.ts          # MemoryStore (markdown-file-backed)
├── vault/
│   ├── notes.ts           # createNote, saveMessageAsNote, saveImageToVault
│   └── active-note.ts     # Resolver for "the note the user means"
├── commands/
│   ├── index.ts           # registerCommands — palette entries
│   ├── selection.ts       # SELECTION_ACTIONS map
│   └── context-menu.ts    # Right-click menu wiring
├── templates/
│   ├── builtins.ts        # 30+ prompt templates
│   └── manager.ts         # TemplateManager (currently unused — v2 feature)
├── ui/modals/             # FolderSuggestModal, ImageSuggestModal, etc.
└── core/                  # EventBus, hooks, secrets, tools, migration
```

## Code style

- **TypeScript strict mode** — `tsc -noEmit -skipLibCheck` must pass with zero errors
- **No `any`** without a comment explaining why
- **Real Obsidian CSS tokens** — use `var(--size-4-N)` (4/8/12/16/20/24/32px scale), `var(--background-primary)`, etc. Never hardcode px values that have token equivalents
- **No new dependencies** without discussion — the plugin ships zero runtime deps by design
- **Comments in code** — match surrounding density. Don't add docstrings to obvious code
- **Commit messages** — conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)

## The audit checklist

Every PR goes through a line-by-line audit before merge. Run through this list yourself before requesting review:

- [ ] `tsc -noEmit -skipLibCheck` passes with no errors
- [ ] `npm run build` produces a working `main.js`
- [ ] No `eval`, `new Function`, or `innerHTML` with user input
- [ ] No new plaintext-secret storage (use `setApiKeyForProvider`)
- [ ] No new network endpoints (or document them in `docs/PROVIDERS.md`)
- [ ] No orphan settings — every new field in `ObsiBuddiSettings` has a UI control AND a consumer
- [ ] No orphan CSS classes — every new class has a matching DOM element
- [ ] Streaming paths handle errors via `onError` (not just try/catch)
- [ ] Image content always has a text fallback (no empty `content` strings)
- [ ] Conversation store mutations always call `save()`
- [ ] Documentation updated if user-facing behavior changed

## Testing

There's no test suite yet (v3.0.0). For now, manual smoke-test the affected feature:

1. Reload the plugin after build
2. Exercise the new code path
3. Check console for errors
4. Verify it works on both light and dark themes
5. If it touches storage, verify data persists across reload

A proper Vitest setup is on the roadmap.

## Filing issues

- 🐛 Bugs: include Obsidian version, plugin version, provider + model, console errors, and reproduction steps
- 💡 Features: describe the workflow you want, not just the implementation

## License

By contributing, you agree your contributions are licensed under the MIT license.
