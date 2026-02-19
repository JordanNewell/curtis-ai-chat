# 🤖 Multi-Provider AI Assistant for Obsidian

A best-in-class multi-provider AI inference plugin for Obsidian supporting **Anthropic Claude**, **Z.ai GLM**, and **Google Gemini** with streaming responses, code assistance, and intelligent content generation.

## ✨ Features

- 💬 **Interactive Chat Interface** - Beautiful chat modal with streaming responses
- 🎯 **Smart Commands** - Generate, summarize, explain, and refine text instantly
- 🔍 **Code Assistant** - Code review and explanation powered by AI
- 🎨 **Multiple Providers** - Switch between Claude, GLM, and Gemini seamlessly
- 🔐 **OAuth Support** - Secure Google OAuth for Gemini authentication
- ⚡ **Streaming Responses** - See responses generate in real-time
- 🎛️ **Customizable** - Configure temperature, max tokens, system prompts, and more
- 🌐 **OpenAI-Compatible** - GLM and Gemini use standard OpenAI format
- 🧠 **Unified Memory** - Cross-tool context sharing with Claude Code memory system

## 🧠 Memory Integration

This plugin integrates with Claude Code's memory system for seamless context sharing across tools.

### Features
- **Bidirectional sync**: Conversations in Obsidian are captured to shared memory
- **Context injection**: Relevant facts are automatically loaded when starting new chats
- **Toggle control**: "🧠 Remember conversation" toggle in chat UI

### How It Works
1. Toggle "🧠 Remember conversation" in the chat UI (default: ON)
2. Your messages are captured to working memory
3. Claude Code's consolidation process extracts facts
4. Future chats automatically load relevant context

### Memory Storage
- Working Memory: `<vault>/memory/working_memory/`
- Consolidated Facts: `<vault>/memory/consolidation/facts.jsonl`

## 🚀 Installation

### Method 1: Manual Installation (Recommended for Personal Use)

1. Download the latest release or clone this repository
2. Build the plugin:
   ```bash
   npm install
   npm run build
   ```
3. Copy the entire plugin folder to your Obsidian vault's plugins directory:
   - **Windows**: `%APPDATA%/obsidian/plugins/`
   - **Mac**: `~/Library/Application Support/obsidian/plugins/`
   - **Linux**: `~/.config/obsidian/plugins/`
4. Enable the plugin in Obsidian: **Settings** → **Community plugins** → Enable "Multi-Provider AI Assistant"

### Method 2: From Source

```bash
# Clone the repository
git clone https://github.com/0xshash/obsidian-multi-provider-ai.git
cd obsidian-multi-provider-ai

# Install dependencies
npm install

# Build the plugin
npm run build
```

## ⚙️ Configuration

### Provider Setup

#### Anthropic Claude
1. Visit [Anthropic Console](https://console.anthropic.com/)
2. Generate an API key
3. In Obsidian, go to **Settings → Multi-Provider AI**
4. Select **Claude** as your provider
5. Enter your API key
6. Choose your preferred model (Sonnet 4.5, Opus 4.6, or Haiku 4.5)

#### Z.ai GLM
1. Visit [Z.ai Developer Portal](https://docs.z.ai/)
2. Sign up for an account and generate an API key
3. In Obsidian, go to **Settings → Multi-Provider AI**
4. Select **GLM** as your provider
5. Enter your API key
6. Choose your preferred model (GLM-4.7, 4-Plus, 4-Air, 4-Flash, or 4-Long)

#### Google Gemini (OAuth Only)
1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new OAuth 2.0 Client ID:
   - Go to **APIs & Services** → **Credentials**
   - Click **Create Credentials** → **OAuth client ID**
   - Application type: **Desktop app**
   - Authorized redirect URIs: `urn:ietf:wg:oauth:2.0:oob`
3. Copy your Client ID and Client Secret
4. In Obsidian, go to **Settings → Multi-Provider AI**
5. Select **Gemini** as your provider
6. Enter your OAuth Client ID and Secret
7. Click **Connect with Google** and complete the OAuth flow
8. Choose your preferred model (Gemini 3 Pro, 3 Flash, 2.5 Pro, or 2.5 Flash)

### Plugin Settings (All Providers)

In Obsidian, go to **Settings → Multi-Provider AI**:

- **Provider**: Select your AI provider (Claude, GLM, or Gemini)
- **Model**: Choose your preferred model from the selected provider
- **Temperature**: Control response creativity (0.0 - 1.0)
- **Max Tokens**: Maximum response length
- **System Prompt**: Customize the AI's behavior
- **Stream Response**: Enable real-time streaming
- **Show Token Usage**: Display token usage notices

## 📖 Usage

### Chat Interface

1. Click the bot icon in the ribbon or use the command palette (`Ctrl/Cmd + Shift + G`)
2. Select your desired provider and model
3. Type your message and press Enter
4. Watch the AI respond in real-time!

### Text Selection Commands

Select any text in your notes and use these commands:

| Command | Description |
|---------|-------------|
| **Generate** | Generate new content from your prompt |
| **Summarize** | Get a concise summary of selected text |
| **Explain** | Break down complex concepts simply |
| **Refine** | Improve writing quality while preserving meaning |
| **Code Review** | Review code for bugs and best practices |
| **Explain Code** | Get detailed code explanations |

### Keyboard Shortcuts

- `Ctrl/Cmd + Shift + G` - Open AI Chat

## 🎯 Available Models

### Claude (Anthropic)
| Model | Description | Context Length |
|-------|-------------|----------------|
| **Claude Opus 4.6** | Most capable for complex tasks | 200K tokens |
| **Claude Sonnet 4.5** | Balanced performance | 200K tokens |
| **Claude Haiku 4.5** | Fast and cost-effective | 200K tokens |

### GLM (Z.ai)
| Model | Description | Context Length |
|-------|-------------|----------------|
| **GLM-4.7** | Latest and most capable | 128K tokens |
| **GLM-4 Plus** | Enhanced performance | 128K tokens |
| **GLM-4 Air** | Balanced performance/cost | 128K tokens |
| **GLM-4 Flash** | Fast responses | 128K tokens |
| **GLM-4 Long** | Extended context | 1M tokens |

### Gemini (Google)
| Model | Description | Context Length |
|-------|-------------|----------------|
| **Gemini 3 Pro** | Latest, most advanced | 1M tokens |
| **Gemini 3 Flash** | Fast, cost-effective | 1M tokens |
| **Gemini 2.5 Pro** | General availability | 1M tokens |
| **Gemini 2.5 Flash** | High-throughput | 1M tokens |
| **Gemini 2.5 Flash Lite** | Lightweight | 1M tokens |

## 🏗️ Architecture

The plugin uses a provider abstraction pattern that allows seamless switching between AI services:

```typescript
interface AIProvider {
  id: string;
  name: string;
  endpoint: string;
  models: AIModel[];
  formatRequest(messages, options): RequestInit;
  parseResponse(response): Promise<AIResponse>;
  isAuthenticated(): boolean;
  authenticate(): Promise<void>;
}
```

Each provider handles its specific API format and authentication method:

- **Claude**: Uses `x-api-key` header with separate `system` parameter
- **GLM**: OpenAI-compatible format with `Bearer` token
- **Gemini**: OpenAI-compatible format with OAuth `Bearer` token

## 🔧 Development

```bash
# Install dependencies
npm install

# Development build with watch mode
npm run dev

# Production build
npm run build
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - feel free to use this plugin personally or commercially.

## 🙏 Acknowledgments

- Built with [Obsidian API](https://github.com/obsidianmd/obsidian-api)
- Powered by:
  - [Anthropic Claude](https://www.anthropic.com/)
  - [Z.ai GLM Models](https://docs.z.ai/)
  - [Google Gemini](https://ai.google.dev/)

## 📞 Support

If you encounter any issues or have questions:
- Open an issue on GitHub
- Check existing discussions

---

Made with ❤️ by [0xshash](https://github.com/0xshash)
