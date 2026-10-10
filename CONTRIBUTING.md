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
├── vitest.config.ts               # Unit tests (Obsidian-free modules run under node)
├── version-bump.mjs               # release helper (bumps manifest + versions.json)
├── docs/                          # user-facing documentation
└── src/
    ├── main.ts                    # Plugin entry — onload/onunload, agent loop, wiring
    ├── settings.ts                # Declarative settings (getSettingDefinitions) + tab
    ├── types.ts                   # Shared TypeScript interfaces
    ├── icons.ts                   # Custom Curtis mark + icon registry
    ├── agents/                    # Named agents — store, resolution, PCP claims parser
    ├── api/                       # public-api.ts — the surface other plugins call
    ├── autocomplete/              # Inline ghost-text completion (editor extension + controller)
    ├── chat/
    │   ├── view.ts                # ChatView (the sidebar ItemView) + multi-pane panes
    │   ├── message-renderer.ts    # Markdown rendering + streaming
    │   ├── message-actions.ts     # Hover toolbar on assistant messages
    │   ├── conversation-store.ts  # Conversation/message persistence (queues, debounce)
    │   ├── conversation-files.ts  # Storage port + vault adapter for conversation notes
    │   ├── conversation-format.ts # Markdown conversation file format (Obsidian-free)
    │   ├── linkify.ts             # Link favicons + tappable vault paths (Obsidian-free)
    │   ├── slash-commands.ts      # Slash command registry
    │   ├── voice.ts               # Whisper STT + speechSynthesis helpers
    │   ├── tts-controller.ts      # Sentence player state machine (Obsidian-free)
    │   ├── tts-backends.ts        # Pluggable speech backends
    │   ├── recap.ts               # /recap end-of-session summary
    │   ├── notifications.ts       # Desktop notifications for finished responses
    │   └── export.ts              # Markdown export
    ├── commands/                  # Palette commands, selection actions, context menu
    ├── core/
    │   ├── tools.ts               # ToolRegistry + built-in vault tools
    │   ├── tool-schema.ts         # Tool JSON-schema builder (Obsidian-free)
    │   ├── command-tools.ts       # run_command agent tool
    │   ├── web-tools.ts           # web_search / read_url agent tools
    │   ├── system-prompt.ts       # Prompt layering: CORE → global extension → persona
    │   ├── secrets.ts             # OS keychain storage
    │   ├── migration.ts           # legacy Curtis Chat → v1 migrations
    │   ├── events.ts              # EventBus
    │   └── types/json-helpers.ts  # Type-guard utilities for JSON boundaries
    ├── gcp/                       # GCP connector — service-account JWT + Cloud Storage tools
    ├── import/                    # ChatGPT / Claude / .curt / JSON / markdown importers
    ├── mcp/
    │   ├── client.ts, manager.ts, transport.ts   # MCP client — user-connected servers
    │   └── server/                # MCP server mode — serves the vault on localhost
    ├── memory/                    # MemoryStore (markdown-file-backed) + session journal
    ├── providers/
    │   ├── registry.ts            # PROVIDER_DEFINITIONS + ProviderRegistry
    │   ├── base.ts                # OpenAICompatibleProvider + request-parameter gating
    │   ├── anthropic.ts           # AnthropicProvider (own message/tool dialect)
    │   ├── ollama.ts              # Ollama native /api/chat dialect
    │   ├── chatgpt.ts             # Responses API provider (ChatGPT sign-in)
    │   ├── chatgpt-signin.ts      # Sign in with ChatGPT — OAuth + token refresh
    │   ├── colors.ts              # Brand color dot per provider id
    │   ├── transport.ts           # HTTP transport (fetch + requestUrl)
    │   ├── stream-shim.ts         # Adapter between Response shapes
    │   └── types/                 # Per-provider response schemas
    ├── rag/                       # Semantic vault retrieval (chunk → embed → retrieve)
    ├── swarm/                     # Leader/follower swarm mode
    ├── terminal/                  # Terminal pane, desktop runner, mobile vault shell (vshell)
    ├── ui/modals/                 # All modal components
    ├── utils/                     # diff (inline rewrite), base64, download helpers
    └── vault/                     # notes.ts, active-note.ts — vault write paths
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

Built-in providers live in `src/providers/registry.ts` (`PROVIDER_DEFINITIONS`); the interface is `ProviderDefinition` in `src/types.ts`.

1. **Add a definition** to `PROVIDER_DEFINITIONS`:

   ```ts
   {
     id: 'my-provider',
     name: 'My Provider',
     endpoint: 'https://api.myprovider.com/v1/chat/completions',
     authType: 'bearer', // 'bearer' | 'anthropic' | 'oauth' | 'key' | 'none'
     autoDiscoverModels: true, // fetch /v1/models at runtime; `models` is the offline fallback
     models: [
       { id: 'my-model', name: 'My Model', contextLength: 128_000, inputPrice: 1.0, outputPrice: 2.0, visionSupported: true, functionCallingSupported: true },
     ],
   }
   ```

   Verify endpoints, key schemes, seed models, and prices against current vendor docs, and say so in a comment (see the existing entries).

2. **If the provider uses a non-OpenAI dialect** (message shape, streaming, tool calling, or reasoning-effort mapping), add a dedicated provider class in `src/providers/<name>.ts` extending `OpenAICompatibleProvider` and overriding the request/response methods. `anthropic.ts`, `ollama.ts`, and `chatgpt.ts` are the references.

3. **Strict APIs** — providers that return 400 on unknown request fields are handled by the capability gating in `base.ts`/`registry.ts`; check how a comparable strict provider (OpenAI, Perplexity Router, Fireworks) is configured and follow it.

4. **Add type schemas** if needed in `src/providers/types/` — every response shape must be strictly typed.

5. **Test** by enabling the provider in settings, pasting a key, and sending a message (and a tool-call turn, if the provider supports agent mode).

6. **Document** in `docs/PROVIDERS.md` — add a row to the providers table with auth, discovery, and agent-compat info.

## How to add a new tool

Tools live in `src/core/tools.ts` and are registered on the `ToolRegistry` (the JSON-schema builder it uses lives in `src/core/tool-schema.ts`, deliberately Obsidian-free). Optional tool groups are defined as `ToolDefinition` constants and registered conditionally: web tools in `core/web-tools.ts`, the command tool in `core/command-tools.ts`, MCP tools via `setMcpTools()`, GCP tools via `setGcpTools()`.

1. **Add a `register()` call** inside `registerBuiltinTools()`:

   ```ts
   this.register({
     name: 'my_tool',
     description: 'What this tool does, so the model knows when to call it',
     parameters: {
       input: { type: 'string', description: 'The input', required: true },
     },
     execute: async (params) => {
       const value = str(params.input);
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

Slash commands live in `src/chat/slash-commands.ts` as entries in the `SLASH_COMMANDS` array of `SlashCommand` objects.

1. **Add an entry** to `SLASH_COMMANDS`:

   ```ts
   {
     name: 'my-command', // invoked as /my-command — lowercase, no leading slash
     usage: '/my-command <arg>',
     description: 'What /my-command does',
     run: (ctx) => {
       if (!ctx.args.trim()) {
         new Notice('Usage: /my-command <arg>');
         return true;
       }
       // ctx.conversationId is the invoking pane's chat — act on it, not on
       // a global current pointer (multi-pane support)
       new Notice(`Done: ${ctx.args.trim()}`);
       return true;
     },
   },
   ```

   `run` returns `true` when the input was consumed (the send is suppressed) and `false` to fall through to a normal send.

2. **Document** in `docs/SLASH_COMMANDS.md` — add a row to the reference table and a section with examples.

3. **Test** by typing `/my-command test` in the chat input.

The slash autocomplete dropdown picks up new commands automatically.

## Testing

`npm test` runs the Vitest suite over `src/**/*.test.ts`. Several modules are deliberately **Obsidian-free** so they run under plain node — the parser/seam code in `src/autocomplete/` (except the editor extension), `conversation-format.ts`, `linkify.ts`, `tts-controller.ts`, `tool-schema.ts`, the terminal `vshell`, and the agents `pcp` parser all carry this boundary in their header comments. Keep it: pure logic goes in an Obsidian-free module with a test next to it; anything importing `obsidian` can't run under node.

Obsidian-bound code paths can't be unit-tested — smoke-test the affected feature by hand:

1. Reload the plugin after build (toggle off/on in Community plugins)
2. Exercise the new code path with realistic input
3. Check the Obsidian dev console (`Ctrl+Shift+I`) for errors
4. Verify it works on both **light and dark themes**
5. If it touches storage, verify data **persists across reload**
6. If it touches mobile, verify on a phone or narrow viewport

Treat the audit checklist below as the merge gate for everything else.

## The audit checklist

Every change goes through a line-by-line audit before merge. Run through this list yourself before requesting review:

- [ ] `tsc -noEmit -skipLibCheck` passes with no errors
- [ ] `npm run lint` reports zero warnings
- [ ] `npm test` passes
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
