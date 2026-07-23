# Contributing

Contributions are welcome — bug reports, feature requests, and (once v1 stabilizes) pull requests. This doc covers dev setup, project structure, code style, the audit checklist every change goes through, and recipes for the most common contributions.

> [!NOTE]
> **Not accepting external PRs yet** while the v1 line stabilizes. Issues and feature requests via [GitHub Issues](../../issues) are very welcome. This doc exists so the contribution path is documented the day that policy flips.

## Project structure

```
.
├── main.ts                        # (built) production bundle
├── manifest.json                  # Obsidian plugin manifest
├── styles.css                     # (built) styles
├── esbuild.config.mjs             # esbuild config — bundler + watch mode
├── tsconfig.json                  # TS strict mode
├── version-bump.mjs               # release helper (bumps manifest + versions.json)
├── docs/                          # user-facing documentation
└── src/
    ├── main.ts                    # Plugin entry — onload/onunload, callAI, agent loop
    ├── settings.ts                # DEFAULT_SETTINGS + CurtisSettingTab
    ├── types.ts                   # Shared TypeScript interfaces
    ├── chat/
    │   ├── view.ts                # ChatView (the sidebar ItemView)
    │   ├── message-renderer.ts    # Markdown rendering + streaming
    │   ├── message-actions.ts     # Hover toolbar on assistant messages
    │   ├── conversation-store.ts  # Conversation/message persistence
    │   ├── slash-commands.ts      # /clear, /regen, /model, /memory, etc.
    │   ├── voice.ts               # Whisper STT + speechSynthesis TTS
    │   └── export.ts              # Markdown export
    ├── providers/
    │   ├── registry.ts            # PROVIDER_DEFINITIONS + ProviderRegistry
    │   ├── base.ts                # OpenAICompatibleProvider
    │   ├── anthropic.ts           # AnthropicProvider (different message shape)
    │   ├── transport.ts           # HTTP transport (fetch + requestUrl)
    │   ├── stream-shim.ts         # Adapter between Response shapes
    │   └── types/                 # Per-provider response schemas
    ├── memory/
    │   └── memory.ts              # MemoryStore (markdown-file-backed)
    ├── vault/
    │   ├── notes.ts               # createNote, saveMessageAsNote, saveImageToVault
    │   └── active-note.ts         # Resolver for "the note the user means"
    ├── commands/
    │   ├── index.ts               # registerCommands — palette entries
    │   ├── selection.ts           # SELECTION_ACTIONS map
    │   └── context-menu.ts        # Right-click menu wiring
    ├── core/
    │   ├── tools.ts               # Curtis Agent tool registry + built-ins
    │   ├── secrets.ts             # OS keychain storage
    │   ├── migration.ts           # legacy Curtis Chat → v1 system prompt migration
    │   ├── events.ts              # EventBus
    │   ├── hooks.ts               # lifecycle hooks
    │   └── types/json-helpers.ts  # Type-guard utilities for JSON boundaries
    ├── ui/modals/                 # All modal components
    ├── utils/diff.ts              # LCS line diff for inline rewrite
    └── templates/                 # Built-in prompt templates
```

## Dev setup

Requirements: **Node 20+**, Obsidian 1.13+, a vault for testing.

```bash
git clone https://github.com/JordanNewell/curtis-ai-chat.git
cd curtis-ai-chat
npm install
```

### Build

```bash
npm run build      # type-check (tsc -noEmit) + production bundle (esbuild)
npm run dev        # watch mode — rebuilds on save
npm run lint       # ESLint with @typescript-eslint recommended-requiring-type-checking
```

The build writes `main.js`, `styles.css` to the repo root. Copy them (plus `manifest.json`) into your vault's `.obsidian/plugins/curtis-ai-chat/` folder to test:

```bash
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/curtis-ai-chat/
```

Then reload the plugin in Obsidian (Settings → Community plugins → toggle off/on).

### Recommended: symlink for fast iteration

```bash
ln -s /path/to/repo/main.js /path/to/vault/.obsidian/plugins/curtis-ai-chat/main.js
ln -s /path/to/repo/manifest.json /path/to/vault/.obsidian/plugins/curtis-ai-chat/manifest.json
ln -s /path/to/repo/styles.css /path/to/vault/.obsidian/plugins/curtis-ai-chat/styles.css
```

Now `npm run dev` rebuilds straight into the vault. Reload plugin to pick up changes.

## Linting expectations

**Zero warnings enforced.** `npm run build` runs `tsc -noEmit -skipLibCheck` which must pass with zero errors, and `npm run lint` runs the strict `@typescript-eslint/recommended-requiring-type-checking` config which must report zero warnings.

If your change adds a warning, fix it before requesting review. The zero-warning baseline is a deliberate project choice — it keeps the codebase honest about types and catches bugs early.

Common fixes:

- **`no-floating-promises`** — add `await` or prefix with `void`
- **`no-explicit-any`** — replace with a proper type or `unknown` + type guard
- **`no-unsafe-assignment` / `no-unsafe-member-access`** — narrow at the JSON boundary with type guards from `src/core/types/json-helpers.ts`
- **Unnecessary type assertions** — `const x = y as Foo` when `y` is already `Foo`. Just remove the assertion.

## Code style

- **TypeScript strict mode** — `tsc -noEmit -skipLibCheck` must pass with zero errors
- **No `any`** without a comment explaining why. Prefer `unknown` + type guards at boundaries.
- **Tabs for indentation** in source files (matches existing convention). Docs use spaces.
- **Real Obsidian CSS tokens** — use `var(--size-4-N)` (4/8/12/16/20/24/32px scale), `var(--background-primary)`, etc. Never hardcode px values that have token equivalents.
- **No new dependencies** without discussion — the plugin ships zero runtime deps by design. Dev dependencies are scrutinized too.
- **Comments match surrounding density.** Don't add docstrings to obvious code.
- **Commit messages** — conventional commits (`feat:`, `fix:`, `chore:`, `docs:`). Subject under 72 chars.

## How to add a new provider

Built-in providers live in `src/providers/registry.ts`.

1. **Add a definition** to `PROVIDER_DEFINITIONS`:

   ```ts
   {
     id: 'my-provider',
     name: 'My Provider',
     endpoint: 'https://api.myprovider.com/v1/chat/completions',
     authType: 'bearer',
     modelsEndpoint: 'https://api.myprovider.com/v1/models',
     docsUrl: 'https://docs.myprovider.com',
     models: [
       { id: 'my-model', name: 'My Model', contextLength: 128_000 },
     ],
   }
   ```

2. **If the provider uses a non-OpenAI message shape** (like Anthropic), add a dedicated provider class in `src/providers/<name>.ts` extending `OpenAICompatibleProvider` and overriding `transformMessages` / `parseStreamChunk`.

3. **Add type schemas** if needed in `src/providers/types/` — every response shape must be strictly typed.

4. **Test** by enabling the provider in settings, pasting a key, and sending a message.

5. **Document** in `docs/PROVIDERS.md` — add a row to the providers table with auth, discovery, and agent-compat info.

## How to add a new tool

Tools live in `src/core/tools.ts` and are registered on the `ToolRegistry`.

1. **Add a `register()` call** inside `registerBuiltinTools()`:

   ```ts
   this.register({
     name: 'my_tool',
     description: 'What this tool does, so the model knows when to call it',
     parameters: {
       input: { type: 'string', description: 'The input', required: true },
     },
     execute: async (params, context) => {
       const value = String(params.input ?? '');
       return `Result: ${value}`;
     },
   });
   ```

2. **Validate at boundaries** — never trust `params.input` to be the right type. Coerce with helpers (`String(x)`, `Number(x)`, or the `str` / `num` helpers in the file).

3. **Return strings, not objects.** The tool result is fed back to the model as a string. If you need structured output, format it as markdown or JSON-in-string.

4. **Document** in `docs/AGENT.md` — add a row to the built-in tools table.

5. **Test** by enabling the agent and asking the model to invoke the tool.

> [!WARNING]
> Tools that modify the vault (`create_note`, `edit_note`) execute immediately on model call — no human-in-the-loop. Be conservative about what you let the model change.

## How to add a slash command

Slash commands live in `src/chat/slash-commands.ts` as a map of `{ [command: string]: SlashCommandHandler }`.

1. **Add a handler** to the `SLASH_COMMANDS` map:

   ```ts
   '/my-command': {
     description: 'What /my-command does',
     usage: '/my-command <arg>',
     handle: async (args, ctx) => {
       const value = args.trim();
       if (!value) {
         new Notice('Usage: /my-command <arg>');
         return;
       }
       // do something
       new Notice(`Done: ${value}`);
     },
   },
   ```

2. **Document** in `docs/SLASH_COMMANDS.md` — add a row to the reference table and a section with examples.

3. **Test** by typing `/my-command test` in the chat input.

The slash autocomplete dropdown picks up new commands automatically.

## Testing

There's **no test suite** yet. For now, manual smoke-test the affected feature:

1. Reload the plugin after build (toggle off/on in Community plugins)
2. Exercise the new code path with realistic input
3. Check the Obsidian dev console (`Ctrl+Shift+I`) for errors
4. Verify it works on both **light and dark themes**
5. If it touches storage, verify data **persists across reload**
6. If it touches mobile, verify on a phone or narrow viewport

A proper Vitest setup is on the roadmap. Until then, treat the audit checklist below as the test gate.

## The audit checklist

Every change goes through a line-by-line audit before merge. Run through this list yourself before requesting review:

- [ ] `tsc -noEmit -skipLibCheck` passes with no errors
- [ ] `npm run lint` reports zero warnings
- [ ] `npm run build` produces a working `main.js`
- [ ] No `eval`, `new Function`, or `innerHTML` with user input
- [ ] No new plaintext-secret storage (use `setApiKeyForProvider`)
- [ ] No new network endpoints (or document them in `docs/PROVIDERS.md`)
- [ ] No orphan settings — every new field in `CurtisSettings` has a UI control AND a consumer
- [ ] No orphan CSS classes — every new class has a matching DOM element
- [ ] Streaming paths handle errors via `onError` (not just try/catch)
- [ ] Image content always has a text fallback (no empty `content` strings)
- [ ] Conversation store mutations always call `save()`
- [ ] Documentation updated if user-facing behavior changed

## Security disclosure

Found a security issue? **Do not open a public issue.** Email [security@jordannewell.com](mailto:security@jordannewell.com) with details and reproduction steps.

Response target: 72 hours to acknowledge, 14 days to a fix or mitigation advisory. Please disclose responsibly — give us time to fix before public discussion.

## Filing issues

- 🐛 **Bugs** — include Obsidian version, plugin version, provider + model, console errors, reproduction steps. Screenshots if relevant.
- 💡 **Features** — describe the workflow you want, not just the implementation. Concrete examples beat abstract proposals.
- 📚 **Docs** — typos, dead links, missing detail. PRs to docs will be considered even during the no-PR window — ask first.

## License

By contributing, you agree your contributions are licensed under the [MIT license](LICENSE).
