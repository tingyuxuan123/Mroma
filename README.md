# Mroma

> 基于 [Proma](https://github.com/ErlichLiu/Proma) 二次开发的本地优先 AI 桌面应用。

Mroma 是一个集成多模型 Chat 和通用 Agent 的开源桌面客户端。它将多供应商对话、Agent 工作区、Skills、MCP、远程机器人桥接和记忆能力整合在一个 Electron 应用中，所有数据默认存储在本地。

## 特性

### Chat 模式
- 多模型对话，支持附件解析和图片输入
- Markdown / Mermaid / KaTeX / 代码高亮渲染
- 并排对话对比
- 系统提示词、上下文分割和管理
- 联网搜索、记忆工具和内置 Chat 工具

### Agent 模式
- 基于 `@anthropic-ai/claude-agent-sdk` 的通用 Agent
- 工作区隔离：每个工作区独立的 MCP Server、Skills 和文件
- 权限模式：safe / ask / allow-all
- 流式长任务输出、计划确认、用户追问
- SubAgent / Tasks 支持

### 模型高级配置
- 每个模型独立配置 Context Token Limit、Max Output Tokens
- 能力开关：图像支持、Fast 模式、1M 扩展上下文
- 配置即时保存，模型选择时自动应用

### 远程机器人
- 飞书 / Lark 机器人桥接
- 钉钉、微信桥接入口
- 手机或群聊触发本机 Agent 工作流

### 本地优先
- 会话、工作区、附件、配置存储在 `~/.mroma/`
- JSON / JSONL 文件组织，无本地数据库
- API Key 通过 Electron `safeStorage` 加密

### 桌面体验
- 自动更新、代理设置、文件预览
- 全局快捷键、快速任务窗口
- 语音输入（支持全局输入）
- 亮色 / 暗色 / 跟随系统主题

## 支持的模型渠道

| 供应商 | Chat | Agent | 协议 |
| --- | --- | --- | --- |
| Anthropic | ✅ | ✅ | Messages API |
| DeepSeek | ✅ | ✅ | Anthropic 兼容 |
| Kimi API | ✅ | ✅ | Anthropic 兼容 |
| Kimi Coding Plan | ✅ | ✅ | Anthropic 兼容 |
| OpenAI | ✅ | — | Chat Completions |
| Google | ✅ | — | Gemini API |
| 智谱 AI | ✅ | ✅ | Anthropic 兼容 |
| MiniMax | ✅ | ✅ | Anthropic 兼容 |
| 豆包 | ✅ | ✅ | Anthropic 兼容 |
| 通义千问 | ✅ | ✅ | Anthropic 兼容 |
| 自定义端点 | ✅ | — | OpenAI 兼容 |

## 快速开始

### 安装依赖

```bash
bun install
```

### 开发模式

```bash
# 自动启动 Vite + Electron + 热重载
bun run dev

# 或手动分步启动
cd apps/electron
bun run dev:vite      # 终端 1：Vite 渲染进程
bun run dev:electron  # 终端 2：Electron 主进程
```

### 构建

```bash
bun run electron:build   # 仅构建
bun run electron:start   # 构建并运行
bun run typecheck        # 类型检查
bun test                 # 测试
```

### 打包分发

```bash
cd apps/electron
bun run dist:mac    # macOS
bun run dist:win    # Windows
bun run dist:linux  # Linux
bun run dist:fast   # 当前架构快速打包
```

## 项目结构

```
mroma/
├── packages/
│   ├── shared/     # 共享类型、IPC 常量、配置、工具函数
│   ├── core/       # Provider Adapter、代码高亮
│   └── ui/         # 共享 React UI 组件
└── apps/
    └── electron/   # Electron 桌面应用
        └── src/
            ├── main/       # 主进程 + 服务层
            ├── preload/    # IPC 上下文桥接
            └── renderer/   # React UI (Vite + Tailwind + Radix UI)
```

包命名规范：`@mroma/*`（`@mroma/core`、`@mroma/shared`、`@mroma/ui`、`@mroma/electron`）

### 本地数据目录

```
~/.mroma/
├── channels.json           # 渠道配置（API Key 加密存储）
├── conversations.json      # 对话索引
├── conversations/          # 对话消息（JSONL）
├── agent-sessions.json     # Agent 会话索引
├── agent-sessions/         # Agent 会话消息（JSONL）
├── agent-workspaces/       # 工作区目录
│   └── {workspace-slug}/
│       ├── workspace-files/
│       ├── mcp.json
│       └── skills/
├── attachments/            # 附件文件
├── user-profile.json       # 用户档案
├── settings.json           # 应用设置
└── sdk-config/             # SDK 配置
```

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 运行时 | Bun |
| 语言 | TypeScript |
| 桌面框架 | Electron 39 |
| 前端 | React 18 |
| 状态管理 | Jotai |
| UI 组件 | Radix UI + Tailwind CSS |
| 富文本 | TipTap |
| 代码高亮 | Shiki |
| 图表 / 公式 | Beautiful Mermaid + KaTeX |
| 构建 | Vite + esbuild |
| 分发 | electron-builder |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` |

## 架构

核心通信路径：

```
shared 类型和 IPC 常量 → main/ipc.ts 处理器 → preload 桥接 → renderer Jotai atoms
```

主进程服务（`apps/electron/src/main/lib/`）：

| 服务 | 职责 |
| --- | --- |
| `agent-orchestrator.ts` | Agent 编排、SDK 调用、事件流 |
| `agent-session-manager.ts` | Agent 会话持久化 |
| `agent-workspace-manager.ts` | 工作区、MCP、Skills 管理 |
| `chat-service.ts` | Chat 流式调用、Provider Adapter |
| `conversation-manager.ts` | 对话管理 |
| `channel-manager.ts` | 渠道 CRUD、API Key 加密 |
| `feishu-bridge.ts` | 飞书机器人桥接 |
| `memory-service.ts` | 跨会话记忆 |

## 致谢

- 原项目 [Proma](https://github.com/ErlichLiu/Proma)
- [Shiki](https://shiki.style/) — 代码高亮
- [Beautiful Mermaid](https://github.com/lukilabs/beautiful-mermaid) — 图表渲染
- [Craft Agents OSS](https://github.com/lukilabs/craft-agents-oss) — Agent SDK 集成模式参考
- [Lobe Icons](https://github.com/lobehub/lobe-icons) — AI 品牌图标

## 许可证

Apache-2.0
