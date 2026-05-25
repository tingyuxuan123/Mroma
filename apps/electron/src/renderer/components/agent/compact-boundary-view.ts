import type { AgentBackend, AgentCompactReason, SDKMessageMetadata, SDKSystemMessage } from '@mroma/shared'

const COMPACT_REASON_LABELS: Record<AgentCompactReason, string> = {
  manual: '手动触发',
  auto: '自动触发',
  prompt_too_long: '上下文过长',
}

const BACKEND_LABELS: Record<AgentBackend, string> = {
  claude: 'Claude 原生压缩',
  codex: 'Codex 托管式压缩',
}

export interface CompactBoundaryViewModel {
  /** 压缩摘要正文；没有摘要时仅显示分割线 */
  summary?: string
  /** 压缩触发原因中文文案 */
  reasonLabel?: string
  /** 后端能力文案 */
  backendLabel?: string
  /** 压缩完成时间（稳定格式，便于测试与展示） */
  compactedAtLabel?: string
  /** 旧 SDK session/thread id，仅用于排障展示 */
  oldSdkSessionId?: string
  /** 解释压缩语义的中文提示 */
  description: string
}

export interface CompactFailedViewModel {
  /** 压缩失败原因 */
  errorMessage: string
  /** 压缩触发原因中文文案 */
  reasonLabel?: string
  /** 后端能力文案 */
  backendLabel?: string
  /** 失败时间（稳定格式，便于测试与展示） */
  failedAtLabel?: string
  /** 旧 SDK session/thread id，失败时应继续保留可用 */
  oldSdkSessionId?: string
  /** 解释失败语义的中文提示 */
  description: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readMetadata(message: SDKSystemMessage): SDKMessageMetadata | undefined {
  const record = message as unknown as Record<string, unknown>
  const metadata = asRecord(record.metadata)
  return metadata as SDKMessageMetadata | undefined
}

export function getCompactReasonLabel(reason: unknown): string | undefined {
  if (reason === 'manual' || reason === 'auto' || reason === 'prompt_too_long') {
    return COMPACT_REASON_LABELS[reason]
  }
  return undefined
}

export function formatCompactBoundaryTime(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toISOString().replace('T', ' ').slice(0, 16)
}

export function buildCompactBoundaryViewModel(message: SDKSystemMessage): CompactBoundaryViewModel {
  const record = message as unknown as Record<string, unknown>
  const metadata = readMetadata(message)
  const backend = metadata?.backend

  return {
    summary: readString(record, 'summary'),
    reasonLabel: getCompactReasonLabel(record.reason),
    backendLabel: backend ? BACKEND_LABELS[backend] : undefined,
    compactedAtLabel: formatCompactBoundaryTime(record.compacted_at),
    oldSdkSessionId: readString(record, 'old_sdk_session_id'),
    description: backend === 'codex'
      ? '旧 Codex thread 已重置，后续对话会使用这份摘要续接上下文；完整历史仍保留在会话中供你查看。'
      : '旧上下文已被压缩为摘要，后续对话会基于摘要继续；完整历史仍保留在会话中供你查看。',
  }
}

export function buildCompactFailedViewModel(message: SDKSystemMessage): CompactFailedViewModel {
  const record = message as unknown as Record<string, unknown>
  const metadata = readMetadata(message)
  const backend = metadata?.backend

  return {
    errorMessage: readString(record, 'message') ?? '压缩上下文失败，请稍后重试。',
    reasonLabel: getCompactReasonLabel(record.reason),
    backendLabel: backend ? BACKEND_LABELS[backend] : undefined,
    failedAtLabel: formatCompactBoundaryTime(record.failed_at),
    oldSdkSessionId: readString(record, 'old_sdk_session_id'),
    description: backend === 'codex'
      ? 'Codex thread 未被重置，原会话上下文仍保持可用。你可以继续对话，或稍后重新压缩。'
      : '原会话上下文仍保持可用。你可以继续对话，或稍后重新压缩。',
  }
}
