# 🚀 Quick Start Guide - Multi-Provider AI Plugin for Obsidian

## Installation Steps

### 1. Build the Plugin

```bash
cd <vault>/obsidian-glm-plugin
npm install
npm run build
```

### 2. Install in Obsidian

1. Open Obsidian
2. Go to **Settings** → **Community plugins**
3. Turn on **Community plugins** (if not already enabled)
4. Click **Browse** and then **Saved on my computer**
5. Navigate to: `<vault>/obsidian-glm-plugin/`
6. Select the folder and click **Open**

### 3. Configure Your Provider

#### Option A: Anthropic Claude
1. Go to **Settings** → **Multi-Provider AI**
2. Select **Claude** as the provider
3. Enter your API key from [https://console.anthropic.com/](https://console.anthropic.com/)
4. Choose your preferred model (Sonnet 4.5 is recommended for most use cases)

#### Option B: Z.ai GLM
1. Go to **Settings** → **Multi-Provider AI**
2. Select **GLM** as the provider
3. Enter your API key from [https://docs.z.ai/](https://docs.z.ai/)
4. Choose your preferred model (GLM-4.7 is recommended)

#### Option C: Google Gemini (OAuth)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 credentials (Desktop app, redirect URI: `urn:ietf:wg:oauth:2.0:oob`)
3. In Obsidian: **Settings** → **Multi-Provider AI**
4. Select **Gemini** as the provider
5. Enter Client ID and Secret
6. Click **Connect with Google** and complete OAuth flow
7. Choose your preferred model (Gemini 2.5 Flash is recommended)

### 4. Start Using!

- **Chat**: Click the bot icon in the ribbon or press `Ctrl/Cmd + Shift + G`
- **Text Actions**: Select text and use commands:
  - Summarize
  - Explain
  - Refine
  - Code Review

## File Structure

```
obsidian-glm-plugin/
├── main.ts           # Main plugin code (multi-provider)
├── providers.ts      # Provider abstraction layer
├── oauth.ts          # OAuth flow for Gemini
├── manifest.json     # Plugin metadata
├── package.json      # Node dependencies
├── styles.css        # UI styling
├── tsconfig.json     # TypeScript config
├── esbuild.config.mjs # Build config
├── README.md         # Full documentation
└── QUICKSTART.md     # This file
```

## Development

```bash
# Watch mode for development
npm run dev

# Production build
npm run build
```

## Getting API Keys

| Provider | Link |
|----------|------|
| **Claude** | [https://console.anthropic.com/](https://console.anthropic.com/) |
| **GLM** | [https://docs.z.ai/](https://docs.z.ai/) |
| **Gemini** | [https://console.cloud.google.com/](https://console.cloud.google.com/) |

## Provider Comparison

| Provider | Models | Context | Auth Method |
|----------|--------|---------|-------------|
| **Claude** | Opus 4.6, Sonnet 4.5, Haiku 4.5 | 200K | API Key |
| **GLM** | 4.7, 4-Plus, 4-Air, 4-Flash, 4-Long | 128K-1M | API Key |
| **Gemini** | 3 Pro, 3 Flash, 2.5 Pro, 2.5 Flash | 1M | OAuth |
