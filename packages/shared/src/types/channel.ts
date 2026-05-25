/**
 * 渠道（Channel）相关类型定义
 *
 * 渠道是用户配置的 AI 供应商连接，包含 API Key、模型列表等信息。
 * API Key 使用 Electron safeStorage 加密后存储在本地配置文件中。
 */

import type { AgentEffort } from './agent'

/**
 * 支持的 AI 供应商类型
 */
export type ProviderType =
  | 'anthropic'
  | 'openai-chat'
  | 'openai-responses'
  | 'deepseek'
  | 'google'
  | 'kimi-api'
  | 'kimi-coding'
  | 'zhipu'
  | 'minimax'
  | 'doubao'
  | 'qwen'

/**
 * 旧版 ProviderType 字面量到当前归一化协议名的迁移映射
 *
 * 历史背景：
 * - 早期分别有 `openai`（OpenAI 官方）、`custom`（任意 OpenAI 兼容端点）、`codex`（OpenAI Codex）
 * - 这三者本质只有两种协议：Chat Completions 与 Responses API
 * - 2026-05 重构：统一成 `openai-chat`（Chat Completions）和 `openai-responses`（Responses API）
 *
 * 此映射供 channel-manager.ts 在加载 channels.json 时一次性改写老数据使用。
 */
export const LEGACY_PROVIDER_MAPPING: Record<string, ProviderType> = {
  openai: 'openai-chat',
  custom: 'openai-chat',
  codex: 'openai-responses',
}

/**
 * 各供应商的默认 Base URL
 */
export const PROVIDER_DEFAULT_URLS: Record<ProviderType, string> = {
  anthropic: 'https://api.anthropic.com',
  'openai-chat': 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/anthropic',
  google: 'https://generativelanguage.googleapis.com',
  'kimi-api': 'https://api.moonshot.cn/anthropic',
  'kimi-coding': 'https://api.kimi.com/coding/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  minimax: 'https://api.minimaxi.com/anthropic',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}

/**
 * 供应商显示名称
 */
export const PROVIDER_LABELS: Record<ProviderType, string> = {
  anthropic: 'Anthropic',
  'openai-chat': 'OpenAI Chat Completions（仅 Chat 模式）',
  'openai-responses': 'OpenAI Responses / Codex（Chat + Agent）',
  deepseek: 'DeepSeek',
  google: 'Google',
  'kimi-api': 'Kimi API (Anthropic 协议)',
  'kimi-coding': 'Kimi Coding Plan',
  zhipu: '智谱 AI',
  minimax: 'MiniMax (API&编程包)',
  doubao: '豆包',
  qwen: '通义千问',
}

/**
 * 支持 Agent 模式的供应商类型
 *
 * - Anthropic 协议兼容渠道（anthropic / deepseek / kimi-api / kimi-coding / minimax）
 *   通过 Claude Agent SDK 调用 `/v1/messages`
 * - openai-responses 通过 OpenAI Codex SDK 走 Responses API（wss + /v1/responses）
 *
 * 不在此集合中的 OpenAI 系渠道：
 * - openai-chat（仅 Chat 模式可用）：Codex CLI 自 2026-02 起移除 `wire_api = "chat"`，
 *   故凡是只实现 Chat Completions 协议的端点（小米 MiMo / 智谱 / 豆包 / 第三方代理等）
 *   都无法接入 Agent 模式。如需接入需自行运维 community proxy（如 va-ai-api-bridge）
 *   在本地把 Responses 翻译成 Chat，并把渠道改用 openai-responses 指向该 proxy。
 */
export const AGENT_COMPATIBLE_PROVIDERS: ReadonlySet<ProviderType> = new Set<ProviderType>([
  'anthropic',
  'deepseek',
  'kimi-api',
  'kimi-coding',
  'minimax',
  'openai-responses',
])

/**
 * 判断供应商是否兼容 Agent 模式
 */
export function isAgentCompatibleProvider(provider: ProviderType): boolean {
  return AGENT_COMPATIBLE_PROVIDERS.has(provider)
}

/**
 * 模型高级配置
 *
 * 每个模型可独立配置上下文窗口、输出限制、能力开关等。
 * 不设置时（undefined）表示使用默认值或自动推断。
 */
export interface ModelAdvancedConfig {
  /** 上下文窗口大小（token 数），如 1000000 = 1M */
  contextTokenLimit?: number
  /** 单次最大输出长度（token 数），如 128000 */
  maxOutputTokens?: number
  /** 是否支持图像输入 */
  supportsImage?: boolean
  /** 是否支持 fast 模式（部分模型有快速推理变体） */
  supportsFast?: boolean
  /** 是否默认启用 Codex Fast 模式 */
  fastMode?: boolean
  /** 默认思考深度（Agent 模式） */
  reasoningEffort?: AgentEffort
  /** 是否开启扩展上下文（如 1M context） */
  enableExtendedContext?: boolean
  /** 是否在上下文接近上限时自动发送 /compact */
  autoCompactEnabled?: boolean
  /** 自动压缩触发阈值百分比（1-100），默认 78 */
  autoCompactThresholdPercent?: number
}

/**
 * 渠道中的模型配置
 */
export interface ChannelModel {
  /** 模型唯一标识（如 claude-sonnet-4-5-20250929） */
  id: string
  /** 模型显示名称 */
  name: string
  /** 是否启用 */
  enabled: boolean
  /** 模型高级配置 */
  advancedConfig?: ModelAdvancedConfig
}

/**
 * 渠道配置
 *
 * 存储在 ~/.mroma/channels.json 中，apiKey 字段为加密后的 base64 字符串
 */
export interface Channel {
  /** 渠道唯一标识 */
  id: string
  /** 渠道名称（用户自定义） */
  name: string
  /** AI 供应商类型 */
  provider: ProviderType
  /** API Base URL */
  baseUrl: string
  /** 加密后的 API Key（base64 编码） */
  apiKey: string
  /** 可用模型列表 */
  models: ChannelModel[]
  /** 是否启用 */
  enabled: boolean
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/**
 * 创建渠道时的输入数据（apiKey 为明文）
 */
export interface ChannelCreateInput {
  name: string
  provider: ProviderType
  baseUrl: string
  /** 明文 API Key，主进程会加密后存储 */
  apiKey: string
  models: ChannelModel[]
  enabled: boolean
}

/**
 * 更新渠道时的输入数据（所有字段可选）
 */
export interface ChannelUpdateInput {
  name?: string
  provider?: ProviderType
  baseUrl?: string
  /** 明文 API Key，为空字符串表示不更新 */
  apiKey?: string
  models?: ChannelModel[]
  enabled?: boolean
}

/**
 * 渠道配置文件格式
 */
export interface ChannelsConfig {
  /** 配置版本号 */
  version: number
  /** 渠道列表 */
  channels: Channel[]
}

/**
 * 连接测试结果
 */
export interface ChannelTestResult {
  /** 是否成功 */
  success: boolean
  /** 结果消息 */
  message: string
}

/**
 * 拉取模型的输入参数（无需已保存的渠道，直接传入凭证）
 */
export interface FetchModelsInput {
  provider: ProviderType
  baseUrl: string
  /** 明文 API Key */
  apiKey: string
}

/**
 * 拉取模型的结果
 */
export interface FetchModelsResult {
  /** 是否成功 */
  success: boolean
  /** 结果消息 */
  message: string
  /** 获取到的模型列表 */
  models: ChannelModel[]
}

/**
 * 渠道相关 IPC 通道常量
 */
export const CHANNEL_IPC_CHANNELS = {
  /** 获取所有渠道列表 */
  LIST: 'channel:list',
  /** 创建渠道 */
  CREATE: 'channel:create',
  /** 更新渠道 */
  UPDATE: 'channel:update',
  /** 删除渠道 */
  DELETE: 'channel:delete',
  /** 解密获取明文 API Key */
  DECRYPT_KEY: 'channel:decrypt-key',
  /** 测试渠道连接 */
  TEST: 'channel:test',
  /** 从供应商拉取可用模型列表 */
  FETCH_MODELS: 'channel:fetch-models',
  /** 直接测试连接（无需已保存渠道，传入明文凭证） */
  TEST_DIRECT: 'channel:test-direct',
} as const
