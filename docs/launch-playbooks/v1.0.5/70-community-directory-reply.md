# community.obsidian.md — reply templates

**Use:** replies on the Obsidian forum (https://community.obsidian.md) — the plugin's directory thread, bug-report threads about the mobile key prompt, and reviews mentioning local/mobile problems.

**Norms:** forum replies should be short, specific, and link the release. Quote the relevant part of the post you're answering. No emoji, no marketing tone. Reply as the author, from the author's forum account.

---

## A. Reply to a bug report: "local provider asks for an API key on mobile"

> **TODO(author):** link the exact thread and quote their report line.

Fixed in 1.0.5. Local providers (Ollama, LM Studio) never needed an API key — the mobile settings flow was wrongly requiring one before it would save the provider. The requirement is removed on all platforms now. Update from Settings → Community plugins and the provider should save without any key field.

If it still prompts after updating, please reply here or open an issue with your provider and OS: https://github.com/JordanNewell/curtis-ai-chat/issues

Thanks for the report — this one blocked the whole local-on-mobile path.

## B. Reply to "does this work offline / with Ollama / on mobile?"

Yes on all three as of 1.0.5. Ollama and LM Studio are built-in providers, and the mobile key-prompt bug that blocked local providers on iOS/Android is fixed in this release. Typical setup: the model runs on your desktop, the phone connects over your LAN (`http://<desktop-ip>:11434/v1/chat/completions`), and nothing leaves your network. Cloud providers (30+ built in) work too, if you ever want them — but they're not required.

Details: https://github.com/JordanNewell/curtis-ai-chat · listed in the directory at https://community.obsidian.md/plugins/curtis-ai-chat

## C. Release-note reply (plugin thread or wherever the release is being announced)

Curtis AI Chat 1.0.5 is out. The headline fix: local providers (Ollama, LM Studio) no longer wrongly require an API key on mobile, so fully-local chat now works on iOS and Android — point the app at a model server on your LAN and nothing leaves your network. The release also carries CI/dependency maintenance. Full changelog: https://github.com/JordanNewell/curtis-ai-chat/blob/master/CHANGELOG.md

## D. Reply to a review that mentions the old behavior

> **TODO(author):** quote the specific line from the review; adjust the first sentence to what they hit.

You're right that this was broken — and it's fixed as of 1.0.5. Local providers no longer ask for an API key on mobile, which was a validation bug, not an intended requirement. If anything else in the review still stands after updating, I'd genuinely like to know: issues are open at https://github.com/JordanNewell/curtis-ai-chat/issues and I read all of them.

---

## Author notes

- Post replies in the existing threads rather than opening new topics — forum threads on a plugin are where future readers land from search, so a dated "fixed in 1.0.5" reply keeps working after launch week.
- Do not reply to threads older than ~6 months except with template B-style answers to questions still getting views; skip resurrecting dead arguments.
- Where the poster reported the bug, reply to them before posting anything generic — the reporter is owed the answer first.
