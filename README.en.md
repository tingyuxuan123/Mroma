# Mroma

> A local-first AI desktop app, forked from [Proma](https://github.com/ErlichLiu/Proma).

Mroma is an open-source desktop client that integrates multi-model Chat and general-purpose Agent into a single Electron app. All data is stored locally by default.

## Features

### Chat Mode
- Multi-model conversations with attachment parsing and image input
- Markdown / Mermaid / KaTeX / code highlighting
- Parallel conversations for model comparison
- System prompts, context dividers, and context management
- Web search, memory tools, and built-in Chat tools

### Agent Mode
- General-purpose Agent powered by `@anthropic-ai/claude-agent-sdk`
- Workspace isolation with independent MCP Servers, Skills, and files
- Permission modes: safe / ask / allow-all
- Streaming long-task output, plan confirmation, and user interaction
- SubAgent / Tasks support

### Model Advanced Configuration
- Per-model Context Token Limit and Max Output Tokens
- Capability toggles: image support, fast mode, 1M extended context
- Auto-save configuration, applied automatically on model selection

### Remote Bots
- Feishu / Lark bot bridging
- DingTalk and WeChat bridge entry points
- Trigger local Agent workflows from mobile or group chat

### Local-First
- Data stored in `~/.mroma/` — conversations, workspaces, attachments, settings
- JSON / JSONL file-based storage, no local database
- API keys encrypted via Electron `safeStorage`

### Desktop Experience
- Auto-update, proxy settings, file preview
- Global shortcuts, quick task window
- Streaming voice input (global)
- Light / dark / system theme

## Supported Providers

| Provider | Chat | Agent | Protocol |
| --- | --- | --- | --- |
| Anthropic | ✅ | ✅ | Messages API |
| DeepSeek | ✅ | ✅ | Anthropic compatible |
| Kimi API | ✅ | ✅ | Anthropic compatible |
| Kimi Coding Plan | ✅ | ✅ | Anthropic compatible |
| OpenAI | ✅ | — | Chat Completions |
| Google | ✅ | — | Gemini API |
| Zhipu AI | ✅ | ✅ | Anthropic compatible |
| MiniMax | ✅ | ✅ | Anthropic compatible |
| Doubao | ✅ | ✅ | Anthropic compatible |
| Qwen | ✅ | ✅ | Anthropic compatible |
| Custom endpoint | ✅ | — | OpenAI compatible |

## Getting Started

### Install Dependencies

```bash
bun install
```

### Development

```bash
# Auto-start Vite + Electron + hot reload
bun run dev

# Or start manually
cd apps/electron
bun run dev:vite      # Terminal 1: Vite renderer
bun run dev:electron  # Terminal 2: Electron main process
```

### Build

```bash
bun run electron:build   # Build only
bun run electron:start   # Build and run
bun run typecheck        # Type check
bun test                 # Tests
```

### Distribution

```bash
cd apps/electron
bun run dist:mac    # macOS
bun run dist:win    # Windows
bun run dist:linux  # Linux
bun run dist:fast   # Current arch quick build
```

## Project Structure

```
mroma/
├── packages/
│   ├── shared/     # Shared types, IPC constants, config, utilities
│   ├── core/       # Provider Adapters, code highlighting
│   └── ui/         # Shared React UI components
└── apps/
    └── electron/   # Electron desktop app
        └── src/
            ├── main/       # Main process + services
            ├── preload/    # IPC context bridge
            └── renderer/   # React UI (Vite + Tailwind + Radix UI)
```

Package naming: `@mroma/*` (`@mroma/core`, `@mroma/shared`, `@mroma/ui`, `@mroma/electron`)

### Local Data Directory

```
~/.mroma/
├── channels.json           # Channel config (encrypted API keys)
├── conversations.json      # Conversation index
├── conversations/          # Messages (JSONL)
├── agent-sessions.json     # Agent session index
├── agent-sessions/         # Agent messages (JSONL)
├── agent-workspaces/       # Workspace directories
│   └── {workspace-slug}/
│       ├── workspace-files/
│       ├── mcp.json
│       └── skills/
├── attachments/            # Attachment files
├── user-profile.json       # User profile
├── settings.json           # App settings
└── sdk-config/             # SDK config
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Bun |
| Language | TypeScript |
| Desktop | Electron 39 |
| Frontend | React 18 |
| State | Jotai |
| UI | Radix UI + Tailwind CSS |
| Rich Text | TipTap |
| Code Highlighting | Shiki |
| Diagrams / Math | Beautiful Mermaid + KaTeX |
| Build | Vite + esbuild |
| Distribution | electron-builder |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` |

## Architecture

Core communication path:

```
shared types and IPC constants → main/ipc.ts handlers → preload bridge → renderer Jotai atoms
```

Main process services (`apps/electron/src/main/lib/`):

| Service | Responsibility |
| --- | --- |
| `agent-orchestrator.ts` | Agent orchestration, SDK calls, event streams |
| `agent-session-manager.ts` | Agent session persistence |
| `agent-workspace-manager.ts` | Workspaces, MCP, Skills management |
| `chat-service.ts` | Chat streaming, Provider Adapters |
| `conversation-manager.ts` | Conversation management |
| `channel-manager.ts` | Channel CRUD, API key encryption |
| `feishu-bridge.ts` | Feishu bot bridge |
| `memory-service.ts` | Cross-session memory |

## Acknowledgements

- Original project [Proma](https://github.com/ErlichLiu/Proma)
- [Shiki](https://shiki.style/) — Code highlighting
- [Beautiful Mermaid](https://github.com/lukilabs/beautiful-mermaid) — Diagram rendering
- [Craft Agents OSS](https://github.com/lukilabs/craft-agents-oss) — Agent SDK integration patterns
- [Lobe Icons](https://github.com/lobehub/lobe-icons) — AI brand icons

## License

Apache-2.0
