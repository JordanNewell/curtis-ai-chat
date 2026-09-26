# Security Policy

## Supported versions

Only the latest release receives security updates.

## Reporting a vulnerability

Email **security@jordannewell.com** with:

- A description of the issue and its impact
- Reproduction steps (a minimal example is ideal)
- Affected version (visible in Obsidian under Settings → Community plugins, or in the plugin folder's manifest.json)

**Do not open a public GitHub issue** for security reports.

If you have a PGP key, encrypt your report. GPG fingerprint of the project's
reporting key:

```
67567DC5E7C5353F85F2AF0DAC05D3F3E0EFA32A
```

## Response timeline

- **Acknowledgment:** within 72 hours
- **Initial assessment:** within 5 business days
- **Fix or mitigation:** target 30 days for high-severity issues

Please refrain from public disclosure until a fix has been published, to
protect downstream users. Reporters will be credited in the release notes
unless they prefer otherwise.

## Scope

**In scope:**

- The plugin code (TypeScript)
- System prompt handling
- API key handling, including the OS-keychain storage path (Obsidian 1.13+ keychain integration — keys are NOT stored in the vault)

**Out of scope:**

- Vulnerabilities in user-supplied LLM provider SDKs — report upstream
- The Obsidian API itself
- Content the plugin generates