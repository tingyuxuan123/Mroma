import type { SDKMessage, SDKSystemMessage } from '@mroma/shared'

const MAX_COMPACT_SOURCE_MESSAGES = 60
const MAX_COMPACT_SUMMARY_CHARS = 12_000
const MAX_MESSAGE_SNIPPET_CHARS = 900

export interface CompactBoundaryScope {
  /** 最近一次压缩边界索引；没有则为 -1 */
  boundaryIndex: number
  /** 最近一次压缩保存的摘要 */
  summary?: string
  /** 最近压缩边界后的消息 */
  messages: SDKMessage[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCompactBoundary(message: SDKMessage): message is SDKSystemMessage {
  return message.type === 'system' && (message as SDKSystemMessage).subtype === 'compact_boundary'
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value
}

function extractTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
      continue
    }
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      parts.push(`[reasoning] ${block.thinking}`)
      continue
    }
    if (block.type === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name : 'tool'
      const input = isRecord(block.input) ? block.input : {}
      const target = input.file_path ?? input.command ?? input.path ?? input.query ?? ''
      parts.push(`[tool_use] ${name}${target ? `: ${String(target)}` : ''}`)
      continue
    }
    if (block.type === 'tool_result') {
      const contentValue = block.content
      const result = typeof contentValue === 'string'
        ? contentValue
        : JSON.stringify(contentValue ?? '', null, 2)
      parts.push(`[tool_result] ${result}`)
    }
  }
  return parts.join('\n')
}

function compactMessageLine(message: SDKMessage): string | null {
  if (message.type !== 'user' && message.type !== 'assistant') return null
  const content = (message as { message?: { content?: unknown } }).message?.content
  const text = extractTextFromContent(content).trim()
  if (!text) return null
  return `[${message.type}] ${truncate(text, MAX_MESSAGE_SNIPPET_CHARS)}`
}

/** 返回最近一次压缩边界后的有效历史，用于新 thread 回填上下文。 */
export function getMessagesAfterLatestCompactBoundary(messages: SDKMessage[]): CompactBoundaryScope {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || !isCompactBoundary(message)) continue
    const summary = typeof message.summary === 'string' ? message.summary : undefined
    return {
      boundaryIndex: index,
      summary,
      messages: messages.slice(index + 1),
    }
  }
  return { boundaryIndex: -1, messages }
}

/**
 * 构建 Mroma 托管式压缩摘要。
 *
 * 当前版本采用确定性 transcript 摘要，保证无需额外模型调用即可重置 Codex thread。
 * 后续可替换为同渠道 LLM 摘要，但持久化格式保持不变。
 */
export function buildManagedCompactSummary(messages: SDKMessage[]): string {
  const scope = getMessagesAfterLatestCompactBoundary(messages)
  const sourceMessages = scope.messages
    .filter((message) => {
      const metadata = (message as { metadata?: { transient?: boolean } }).metadata
      return metadata?.transient !== true && !isCompactBoundary(message)
    })
    .slice(-MAX_COMPACT_SOURCE_MESSAGES)

  const lines = sourceMessages
    .map(compactMessageLine)
    .filter((line): line is string => Boolean(line))

  const body = lines.length > 0
    ? lines.join('\n\n')
    : '暂无可压缩的文本上下文。'
  const prefix = [
    'Mroma 托管式上下文压缩摘要',
    `压缩范围：最近 ${sourceMessages.length} 条有效消息`,
    '说明：旧 Codex thread 已被重置；后续新 thread 会以本摘要作为历史上下文继续工作。',
    '',
  ].join('\n')

  return truncate(`${prefix}${body}`, MAX_COMPACT_SUMMARY_CHARS)
}
