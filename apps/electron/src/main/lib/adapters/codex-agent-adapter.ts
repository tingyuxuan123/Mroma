/**
 * OpenAI Codex Agent SDK 适配器
 *
 * 基于 @openai/codex-sdk 包，通过 spawn `codex` CLI 子进程并经 stdin/stdout 交换
 * JSONL 事件实现 Agent 能力。本适配器把 Codex 的事件流（thread.started /
 * turn.started / item.* / turn.completed / error）翻译为 Mroma 与
 * ClaudeAgentAdapter 共用的伪 SDKMessage 流，使 AgentOrchestrator 几乎无需感知
 * 后端差异。
 *
 * 依赖：用户必须先全局安装 codex CLI：
 *   - macOS / Linux:   curl -fsSL https://chatgpt.com/codex/install.sh | sh
 *   - npm:             npm install -g @openai/codex
 *   - Homebrew:        brew install --cask codex
 *
 * MVP 范围：
 *   - 文本对话 / 图片输入 / 命令执行 / 文件变更 / 计划更新 / 网络检索
 *   - item.started / item.updated 实时活动更新
 *   - 结构化输出 Schema 透传
 *   - 通过 CODEX_API_KEY + OPENAI_BASE_URL 接入 OpenAI 或 OpenAI 兼容端点
 *   - 三档权限通过 Codex 沙箱模式映射（read-only / workspace-write / danger-full-access）
 *   - 不实现：SDK 级 canUseTool、queued message 注入、app-server 长生命周期会话
 *
 * 接口策略：
 *   - 接受与 ClaudeAgentQueryOptions 完全相同形状的 query options（由 orchestrator
 *     统一构造），内部只读取通用字段（sessionId / prompt / cwd / model / env /
 *     sdkPermissionMode / resumeSessionId / systemPrompt / onSessionId / onStderr /
 *     onModelResolved），其余 Claude 专有字段（sdkCliPath / canUseTool / agents /
 *     thinking / effort / mcpServers / plugins / enableFileCheckpointing / 等）
 *     一律忽略。
 */

import { existsSync } from 'node:fs'
import { extname } from 'node:path'
import type {
  AgentQueryInput,
  AgentProviderAdapter,
  AgentEffort,
  MromaPermissionMode,
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKCodexCumulativeUsage,
  JsonSchemaOutputFormat,
} from '@mroma/shared'

// ============================================================================
// orchestrator 传入的 query options 子集（与 ClaudeAgentQueryOptions 兼容）
// ============================================================================

/**
 * Codex 适配器实际读取的字段集合
 *
 * 这是 ClaudeAgentQueryOptions 的"使用子集"——orchestrator 仍然按 Claude 形状
 * 构造完整 options 传入，本 adapter 只读自己关心的字段。
 */
interface CodexQueryView extends AgentQueryInput {
  /** 环境变量（含 ANTHROPIC_/OPENAI_ 等，从中提取 OPENAI_API_KEY 和 OPENAI_BASE_URL） */
  env?: Record<string, string | undefined>
  /** Mroma 权限模式（直接复用 sdkPermissionMode 字段，与 Mroma 三档 1:1 等价） */
  sdkPermissionMode?: MromaPermissionMode
  /** resume 时使用的 thread_id（Codex 的 thread_id 持久化在 Mroma 的 sdkSessionId 字段） */
  resumeSessionId?: string
  /** 系统提示词（字符串或 preset 对象，取 append 字段；Codex 路径下作为 instructions 前置注入） */
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string }
  /** 捕获 Codex thread_id（首次 thread.started 事件时回填） */
  onSessionId?: (threadId: string) => void
  /** stderr / 调试输出回调 */
  onStderr?: (data: string) => void
  /** 模型确认回调（Codex 没有 model 协商，直接回传传入 model） */
  onModelResolved?: (model: string) => void
  /** 推理深度等级（映射到 Codex modelReasoningEffort） */
  effort?: AgentEffort
  /** 附加的外部目录（映射到 Codex --add-dir） */
  additionalDirectories?: string[]
  /** Codex 原生 Web Search 模式 */
  webSearchMode?: 'disabled' | 'cached' | 'live'
  /** workspace-write 沙箱是否允许命令联网 */
  networkAccessEnabled?: boolean
  /** 结构化 JSON 输出格式 */
  outputFormat?: JsonSchemaOutputFormat
  /** Codex Fast 模式 */
  fastMode?: boolean
  /** 模型上下文窗口（来自 Mroma 模型高级配置） */
  contextWindow?: number
  /** 上一次 Codex exec 暴露的累计 usage，用于把本次累计值换算为本轮用量 */
  codexPreviousUsage?: SDKCodexCumulativeUsage
}

// ============================================================================
// 全局状态
// ============================================================================

const activeControllers = new Map<string, AbortController>()
const activeThreadIds = new Map<string, string>()

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
type CodexConfigObject = NonNullable<import('@openai/codex-sdk').CodexOptions['config']>

// ============================================================================
// 权限模式映射
// ============================================================================

/**
 * 将 Mroma 三档权限模式映射为 Codex SDK 的 sandboxMode + approvalPolicy
 *
 * Codex 的安全模型：
 * - sandboxMode: read-only / workspace-write / danger-full-access
 * - approvalPolicy: never / on-failure / on-request / untrusted
 *
 * Mroma 三档：
 * - plan: 计划模式，只允许只读 → read-only + never（不打断流式输出）
 * - auto: 安全模式，需用户确认敏感操作 → workspace-write + on-failure
 * - bypassPermissions: 完全自动 → danger-full-access + never
 */
function buildCodexSandboxConfig(mode: MromaPermissionMode): {
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy: 'never' | 'on-failure' | 'on-request' | 'untrusted'
} {
  switch (mode) {
    case 'plan':
      return { sandboxMode: 'read-only', approvalPolicy: 'never' }
    case 'bypassPermissions':
      return { sandboxMode: 'danger-full-access', approvalPolicy: 'never' }
    case 'auto':
    default:
      return { sandboxMode: 'workspace-write', approvalPolicy: 'on-failure' }
  }
}

// ============================================================================
// 事件 → SDKMessage 形状转换
// ============================================================================

/** Codex SDK 事件的最小结构（避免硬依赖 SDK 类型） */
interface CodexEvent {
  type: string
  thread_id?: string
  item?: CodexItem
  usage?: CodexUsage
  error?: { message?: string; code?: string }
  message?: string
}

export interface CodexItem {
  id: string
  type: string
  status?: string
  text?: string
  command?: string
  aggregated_output?: string
  exit_code?: number
  stdout?: string
  stderr?: string
  output?: string
  path?: string
  diff?: string
  changes?: Array<{ path: string; kind?: string }>
  server?: string
  tool?: string
  name?: string
  arguments?: unknown
  result?: unknown
  error?: { message?: string }
  query?: string
  results?: unknown
  plan?: unknown
  steps?: Array<{ step: string; status?: string }>
  items?: Array<{ text: string; completed: boolean }>
  reasoning?: string
  message?: string
  [key: string]: unknown
}

interface CodexUsage {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
}

interface CodexResultUsageOptions {
  model?: string
  contextWindow?: number
  previousUsage?: SDKCodexCumulativeUsage
}

function makeAssistantText(text: string, model?: string): SDKAssistantMessage {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text }],
      ...(model && { model }),
    },
    parent_tool_use_id: null,
  }
}

function makeAssistantThinking(thinking: string): SDKAssistantMessage {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'thinking', thinking }],
    },
    parent_tool_use_id: null,
  }
}

function makeAssistantToolUse(
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
): SDKAssistantMessage {
  return {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: toolName,
          input,
        },
      ],
    },
    parent_tool_use_id: null,
  }
}

function makeUserToolResult(
  toolUseId: string,
  content: string,
  isError: boolean,
): SDKUserMessage {
  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          is_error: isError,
        },
      ],
    },
    parent_tool_use_id: null,
  }
}

function markCodexStreamingMessage<T extends SDKMessage>(
  message: T,
  key: string,
  transient: boolean,
): T {
  const record = message as Record<string, unknown>
  record._codexStreamingKey = key
  if (transient) {
    record._codexTransient = true
  }
  return message
}

function stringifyCodexPayload(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return JSON.stringify(value, null, 2)
}

function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())
}

export function extractAttachedImagePaths(prompt: string): string[] {
  const blockMatch = prompt.match(/<attached_files>\n?([\s\S]*?)\n?<\/attached_files>/)
  if (!blockMatch) return []

  const imagePaths: string[] = []
  const lines = blockMatch[1]?.split('\n') ?? []
  for (const line of lines) {
    const lineMatch = line.match(/^-\s+.+?:\s+(.+)$/)
    const filePath = lineMatch?.[1]?.trim()
    if (!filePath || !isImagePath(filePath) || !existsSync(filePath)) continue
    if (!imagePaths.includes(filePath)) imagePaths.push(filePath)
  }
  return imagePaths
}

export function mapEffortToCodex(effort: AgentEffort | undefined): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  if (!effort) return undefined
  return effort === 'max' ? 'xhigh' : effort
}

export function buildCodexConfig(fastMode: boolean | undefined): CodexConfigObject | undefined {
  if (!fastMode) return undefined
  return {
    service_tier: 'fast',
    fast_mode: true,
    features: { fast_mode: true },
  }
}

function positiveDelta(current: number | undefined, previous: number | undefined): number {
  return Math.max(0, (current ?? 0) - (previous ?? 0))
}

export function buildCodexTurnUsage(
  cumulativeUsage: CodexUsage | undefined,
  previousUsage?: SDKCodexCumulativeUsage,
): { input_tokens: number; output_tokens: number; cache_read_input_tokens: number } {
  const cumulativeInputTokens = positiveDelta(cumulativeUsage?.input_tokens, previousUsage?.input_tokens)
  const cachedInputTokens = positiveDelta(cumulativeUsage?.cached_input_tokens, previousUsage?.cached_input_tokens)
  const outputTokens = positiveDelta(cumulativeUsage?.output_tokens, previousUsage?.output_tokens)
  const reasoningOutputTokens = positiveDelta(cumulativeUsage?.reasoning_output_tokens, previousUsage?.reasoning_output_tokens)

  return {
    // Codex/OpenAI 的 input_tokens 已包含 cached_input_tokens；Mroma 前端会把 cache_read
    // 加回 inputTokens，因此这里先扣掉缓存部分，避免上下文用量被双算。
    input_tokens: Math.max(0, cumulativeInputTokens - cachedInputTokens),
    output_tokens: outputTokens + reasoningOutputTokens,
    cache_read_input_tokens: cachedInputTokens,
  }
}

/**
 * 把 Codex item.completed 中的单个 item 转换为一组伪 SDKMessage。
 *
 * 多数 item 会产出"工具调用 + 工具结果"一对消息，便于 UI 复用 Claude 路径的
 * 工具渲染组件（如 ToolActivityItem）。
 */
export function convertCodexItemToSDKMessages(
  item: CodexItem,
  options: { transient?: boolean; includeToolResult?: boolean } = {},
): SDKMessage[] {
  const messages: SDKMessage[] = []
  const toolUseId = item.id
  const transient = options.transient ?? false
  const includeToolResult = options.includeToolResult ?? true
  const assistantKey = `codex:${item.id}:assistant`
  const resultKey = `codex:${item.id}:result`
  const systemKey = `codex:${item.id}:system`

  switch (item.type) {
    case 'agent_message': {
      if (item.text) {
        messages.push(markCodexStreamingMessage(makeAssistantText(item.text), assistantKey, transient))
      }
      break
    }
    case 'reasoning': {
      const text = item.reasoning || item.text || ''
      if (text) {
        messages.push(markCodexStreamingMessage(makeAssistantThinking(text), assistantKey, transient))
      }
      break
    }
    case 'command_execution': {
      const command = item.command || ''
      messages.push(markCodexStreamingMessage(makeAssistantToolUse(toolUseId, 'Bash', { command }), assistantKey, transient))
      const stdout = item.aggregated_output || item.stdout || item.output || ''
      const stderr = item.stderr || ''
      const exitCode = item.exit_code
      const isError = item.status === 'failed'
        || (typeof exitCode === 'number' && exitCode !== 0)
        || (!stdout && !!stderr)
      const resultParts: string[] = []
      if (stdout) resultParts.push(stdout)
      if (stderr) resultParts.push(`[stderr]\n${stderr}`)
      if (typeof exitCode === 'number') resultParts.push(`[exit_code] ${exitCode}`)
      if (includeToolResult) {
        messages.push(markCodexStreamingMessage(
          makeUserToolResult(toolUseId, resultParts.join('\n\n') || '(no output)', isError),
          resultKey,
          transient,
        ))
      }
      break
    }
    case 'file_change': {
      const changes = item.changes ?? (item.path ? [{ path: item.path, kind: 'edit' }] : [])
      const summary = changes.map((c) => `${c.kind ?? 'edit'} ${c.path}`).join('\n')
      messages.push(
        markCodexStreamingMessage(
          makeAssistantToolUse(toolUseId, 'Edit', {
            file_path: changes[0]?.path ?? '',
            changes,
            ...(item.diff && { diff: item.diff }),
          }),
          assistantKey,
          transient,
        ),
      )
      if (includeToolResult) {
        messages.push(markCodexStreamingMessage(makeUserToolResult(toolUseId, summary || '(no changes)', false), resultKey, transient))
      }
      break
    }
    case 'mcp_tool_call': {
      const toolName = `${item.server ?? 'mcp'}__${item.tool ?? item.name ?? 'tool'}`
      const args = (item.arguments as Record<string, unknown>) ?? {}
      messages.push(markCodexStreamingMessage(makeAssistantToolUse(toolUseId, toolName, args), assistantKey, transient))
      const isError = item.status === 'failed' || item.error != null
      const resultText = isError
        ? ((item.error?.message ?? stringifyCodexPayload(item.result)) || '(tool failed)')
        : (stringifyCodexPayload(item.result) || '(no result)')
      if (includeToolResult) {
        messages.push(markCodexStreamingMessage(makeUserToolResult(toolUseId, resultText, isError), resultKey, transient))
      }
      break
    }
    case 'web_search': {
      messages.push(
        markCodexStreamingMessage(
          makeAssistantToolUse(toolUseId, 'WebSearch', { query: item.query ?? '' }),
          assistantKey,
          transient,
        ),
      )
      const resultText = typeof item.results === 'string'
        ? item.results
        : JSON.stringify(item.results ?? '', null, 2)
      if (includeToolResult) {
        messages.push(markCodexStreamingMessage(makeUserToolResult(toolUseId, resultText, false), resultKey, transient))
      }
      break
    }
    case 'plan_update':
    case 'todo_list': {
      const steps = item.steps ?? item.items?.map((todo) => ({
        step: todo.text,
        status: todo.completed ? 'completed' : 'pending',
      })) ?? []
      messages.push(
        markCodexStreamingMessage(
          makeAssistantToolUse(toolUseId, 'TaskUpdate', {
            plan: item.plan ?? item.items ?? steps,
          }),
          assistantKey,
          transient,
        ),
      )
      const planText = steps.length > 0
        ? steps.map((s) => `[${s.status ?? 'pending'}] ${s.step}`).join('\n')
        : JSON.stringify(item.plan ?? '', null, 2)
      if (includeToolResult) {
        messages.push(markCodexStreamingMessage(makeUserToolResult(toolUseId, planText, false), resultKey, transient))
      }
      break
    }
    case 'error': {
      const message = typeof item.message === 'string' ? item.message : 'Codex reported a non-fatal error'
      messages.push(markCodexStreamingMessage(makeAssistantText(message), assistantKey, transient))
      break
    }
    default: {
      const sys: SDKSystemMessage = {
        type: 'system',
        subtype: `codex_${item.type}`,
        ...(item as unknown as Record<string, unknown>),
      }
      messages.push(markCodexStreamingMessage(sys, systemKey, transient))
      break
    }
  }

  return messages
}

function makeResultMessage(
  subtype: 'success' | 'error_during_execution',
  usage: CodexUsage | undefined,
  errors?: string[],
  options: CodexResultUsageOptions = {},
): SDKResultMessage {
  const turnUsage = buildCodexTurnUsage(usage, options.previousUsage)
  return {
    type: 'result',
    subtype,
    usage: turnUsage,
    ...(usage && { _codexCumulativeUsage: usage }),
    ...(options.model && options.contextWindow && {
      modelUsage: { [options.model]: { contextWindow: options.contextWindow } },
    }),
    ...(errors && errors.length > 0 && { errors }),
  }
}

/** 从 systemPrompt 字段提取实际要注入的提示词文本 */
function extractSystemPromptText(
  systemPrompt: CodexQueryView['systemPrompt'],
): string {
  if (!systemPrompt) return ''
  if (typeof systemPrompt === 'string') return systemPrompt
  return systemPrompt.append ?? ''
}

// ============================================================================
// CodexAgentAdapter
// ============================================================================

/**
 * Codex SDK 适配器
 *
 * 注意：codex-sdk 是纯 ESM 包，本类使用动态 import 延迟加载，未安装时不会阻断
 * 主进程启动，仅在用户实际选择 Codex 渠道发起请求时才触发 import。
 */
export class CodexAgentAdapter implements AgentProviderAdapter {
  abort(sessionId: string): void {
    const controller = activeControllers.get(sessionId)
    if (controller) {
      controller.abort()
      activeControllers.delete(sessionId)
    }
    activeThreadIds.delete(sessionId)
  }

  dispose(): void {
    for (const [, controller] of activeControllers) {
      try {
        controller.abort()
      } catch {
        // 忽略已 abort 的 controller
      }
    }
    activeControllers.clear()
    activeThreadIds.clear()
  }

  /**
   * 发起 Codex 查询并返回伪 SDKMessage 流
   *
   * 内部步骤：
   * 1. 抢占 AbortController
   * 2. 动态 import @openai/codex-sdk
   * 3. 从 input.env 提取 API Key + Base URL
   * 4. 构造 Codex 实例 + sandbox 配置
   * 5. startThread 或 resumeThread
   * 6. runStreamed → 翻译事件 → yield SDKMessage
   */
  async *query(input: AgentQueryInput): AsyncIterable<SDKMessage> {
    const opts = input as CodexQueryView
    const {
      sessionId,
      prompt,
      cwd,
      model,
      env,
      sdkPermissionMode,
      resumeSessionId,
      systemPrompt,
      onSessionId,
      onStderr,
      onModelResolved,
      effort,
      additionalDirectories,
      webSearchMode,
      networkAccessEnabled,
      outputFormat,
      fastMode,
      contextWindow,
      codexPreviousUsage,
    } = opts

    // 1. 抢占式注册 AbortController（外部 abort 需立刻生效）
    const controller = new AbortController()
    activeControllers.set(sessionId, controller)

    // 2. 从 env 中提取认证信息
    const apiKey = env?.OPENAI_API_KEY ?? env?.CODEX_API_KEY ?? ''
    const baseUrl = env?.OPENAI_BASE_URL ?? env?.CODEX_BASE_URL ?? undefined
    const resultUsageOptions: CodexResultUsageOptions = {
      model,
      contextWindow,
      previousUsage: codexPreviousUsage,
    }
    if (!apiKey) {
      yield makeResultMessage('error_during_execution', undefined, [
        'OPENAI_API_KEY 未配置：请在渠道设置中填入 API Key',
      ], resultUsageOptions)
      activeControllers.delete(sessionId)
      return
    }

    // 3. 动态 import codex-sdk
    let CodexCtor: typeof import('@openai/codex-sdk').Codex
    try {
      const mod = await import('@openai/codex-sdk')
      CodexCtor = mod.Codex
    } catch (err) {
      yield makeResultMessage('error_during_execution', undefined, [
        `无法加载 @openai/codex-sdk: ${err instanceof Error ? err.message : String(err)}。请确认已安装 codex CLI（npm i -g @openai/codex 或 brew install --cask codex）。`,
      ], resultUsageOptions)
      activeControllers.delete(sessionId)
      return
    }

    // 4. 构造 Codex 实例（sandbox 配置改放进 ThreadOptions，env 用于传基础变量）
    const permissionMode = sdkPermissionMode ?? 'auto'
    const sandboxConfig = buildCodexSandboxConfig(permissionMode)

    const codexEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(env ?? {})) {
      if (typeof value === 'string') codexEnv[key] = value
    }
    codexEnv.CODEX_API_KEY = apiKey
    codexEnv.OPENAI_API_KEY = apiKey
    if (baseUrl) codexEnv.OPENAI_BASE_URL = baseUrl

    // 4. 构造 Codex 实例
    //    走 codex 默认的 openai provider（Responses API：wss + /v1/responses）。
    //    历史尝试：曾用自定义 model_providers.* + wire_api = "chat" 适配只支持 Chat
    //    Completions 协议的第三方端点（小米 MiMo / 智谱 / 第三方代理等），但 codex
    //    自 2026-02 PR #10157 起彻底移除 wire_api = "chat" 支持，回退方案已删除。
    //    如需接入只有 Chat Completions 的端点，建议在本地起 va-ai-api-bridge 等
    //    Responses→Chat proxy，并把渠道 baseUrl 指向该 proxy。
    const codex = new CodexCtor({
      apiKey,
      ...(baseUrl && { baseUrl }),
      ...(fastMode && { config: buildCodexConfig(fastMode) }),
      env: codexEnv,
    })

    // 5. 构造 ThreadOptions（sandbox / approval / model / cwd 都放这里）
    const modelReasoningEffort = mapEffortToCodex(effort)
    const threadOptions: import('@openai/codex-sdk').ThreadOptions = {
      sandboxMode: sandboxConfig.sandboxMode,
      approvalPolicy: sandboxConfig.approvalPolicy,
      // 模型名疑似 Claude 时不强制注入（orchestrator 没有 Codex 专属默认）
      ...(model && !model.toLowerCase().includes('claude') && { model }),
      ...(cwd && { workingDirectory: cwd }),
      // Mroma 的 session 工作目录不是 git repo，必须跳过强制检查
      skipGitRepoCheck: true,
      ...(modelReasoningEffort && { modelReasoningEffort }),
      ...(additionalDirectories && additionalDirectories.length > 0 && { additionalDirectories }),
      ...(webSearchMode && { webSearchMode }),
      ...(networkAccessEnabled != null && { networkAccessEnabled }),
    }

    // 6. startThread / resumeThread
    const thread = resumeSessionId
      ? codex.resumeThread(resumeSessionId, threadOptions)
      : codex.startThread(threadOptions)

    // 6. 拼接最终 prompt：systemPrompt 作为前置指令注入
    const systemText = extractSystemPromptText(systemPrompt)
    const finalPrompt = systemText
      ? `${systemText}\n\n---\n\n${prompt}`
      : prompt
    const imagePaths = extractAttachedImagePaths(finalPrompt)
    const runInput: import('@openai/codex-sdk').Input = imagePaths.length > 0
      ? [
          { type: 'text', text: finalPrompt },
          ...imagePaths.map((path) => ({ type: 'local_image' as const, path })),
        ]
      : finalPrompt

    // 7. 运行并转换事件流
    let finalUsage: CodexUsage | undefined
    let resultEmitted = false
    let resolvedModelEmitted = false

    try {
      const runResult = await thread.runStreamed(runInput, {
        signal: controller.signal,
        ...(outputFormat?.schema && { outputSchema: outputFormat.schema }),
      })
      const events = runResult.events as AsyncIterable<CodexEvent>

      for await (const event of events) {
        if (controller.signal.aborted) {
          yield makeResultMessage('error_during_execution', finalUsage, ['用户中止'], resultUsageOptions)
          resultEmitted = true
          break
        }

        switch (event.type) {
          case 'thread.started': {
            if (event.thread_id) {
              activeThreadIds.set(sessionId, event.thread_id)
              onSessionId?.(event.thread_id)
              // 发送一条 system init 消息，让 orchestrator 捕获 sessionId
              const sys: SDKSystemMessage = {
                type: 'system',
                subtype: 'init',
                session_id: event.thread_id,
                ...(model && { model }),
              }
              yield sys
              if (model && !resolvedModelEmitted) {
                onModelResolved?.(model)
                resolvedModelEmitted = true
              }
            }
            break
          }
          case 'turn.started': {
            break
          }
          case 'item.started': {
            if (event.item) {
              const msgs = convertCodexItemToSDKMessages(event.item, { transient: true, includeToolResult: false })
              for (const msg of msgs) yield msg
            }
            break
          }
          case 'item.updated': {
            if (event.item) {
              const msgs = convertCodexItemToSDKMessages(event.item, { transient: true })
              for (const msg of msgs) yield msg
            }
            break
          }
          case 'item.completed': {
            if (event.item) {
              const msgs = convertCodexItemToSDKMessages(event.item)
              for (const msg of msgs) yield msg
            }
            break
          }
          case 'turn.completed': {
            finalUsage = event.usage
            yield makeResultMessage('success', finalUsage, undefined, resultUsageOptions)
            resultEmitted = true
            break
          }
          case 'turn.failed': {
            const message = event.error?.message ?? event.message ?? 'turn failed'
            yield makeResultMessage('error_during_execution', finalUsage, [message], resultUsageOptions)
            resultEmitted = true
            break
          }
          case 'error': {
            const message = event.error?.message ?? event.message ?? 'codex error'
            onStderr?.(message)
            yield makeResultMessage('error_during_execution', finalUsage, [message], resultUsageOptions)
            resultEmitted = true
            break
          }
          default: {
            onStderr?.(`[codex unknown event] ${JSON.stringify(event)}`)
            break
          }
        }

        if (resultEmitted) break
      }

      // 兜底：如果迭代器自然结束但未发 result，补一条
      if (!resultEmitted) {
        yield makeResultMessage('success', finalUsage, undefined, resultUsageOptions)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      onStderr?.(message)
      yield makeResultMessage('error_during_execution', finalUsage, [message], resultUsageOptions)
    } finally {
      activeControllers.delete(sessionId)
    }
  }
}
