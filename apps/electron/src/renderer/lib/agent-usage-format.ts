import type { AgentBackend, AgentContextUsage } from '@mroma/shared'

export function formatAgentUsageSource(source?: AgentContextUsage['source']): string | undefined {
  if (!source) return undefined
  if (source === 'sdk') return 'SDK 精确值'
  if (source === 'estimated') return '估算'
  if (source === 'configured') return '配置值'
  return '兜底估算'
}

export function formatAgentUsageScope(
  scope?: AgentContextUsage['scope'],
  backend?: AgentBackend,
): string | undefined {
  if (!scope) return undefined
  if (scope === 'turn') return backend === 'codex' ? '本轮用量估算' : '本轮模型调用'
  if (scope === 'active_context') return '当前活跃上下文'
  return '会话累计'
}

export function getPureInputTokens(
  inputTokens: number,
  cacheReadTokens?: number,
  cacheCreationTokens?: number,
): number {
  void cacheReadTokens
  void cacheCreationTokens
  // Agent SDK / Anthropic usage 中 input_tokens 与 cache_read/cache_creation 是并列字段，
  // 不能相加或相减；否则缓存命中较大时会把静态 prompt cache 误算成会话上下文。
  return Math.max(0, inputTokens)
}
