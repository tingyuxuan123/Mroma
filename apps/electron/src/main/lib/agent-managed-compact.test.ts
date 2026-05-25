import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@mroma/shared'
import { buildManagedCompactSummary, getMessagesAfterLatestCompactBoundary } from './agent-managed-compact'

function userMessage(text: string, metadata?: Record<string, unknown>): SDKMessage {
  return {
    type: 'user',
    message: { content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    ...(metadata && { metadata }),
  } as unknown as SDKMessage
}

function assistantMessage(content: unknown[], metadata?: Record<string, unknown>): SDKMessage {
  return {
    type: 'assistant',
    message: { content },
    ...(metadata && { metadata }),
  } as unknown as SDKMessage
}

function compactBoundary(summary: string): SDKMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    summary,
  } as unknown as SDKMessage
}

describe('Mroma 托管式上下文压缩', () => {
  test('given no compact boundary when scoping messages then returns full history', () => {
    const messages = [userMessage('first'), assistantMessage([{ type: 'text', text: 'second' }])]

    const scope = getMessagesAfterLatestCompactBoundary(messages)

    expect(scope.boundaryIndex).toBe(-1)
    expect(scope.summary).toBeUndefined()
    expect(scope.messages).toEqual(messages)
  })

  test('given multiple compact boundaries when scoping messages then uses latest boundary summary', () => {
    const afterLatest = userMessage('after latest compact')
    const messages = [
      userMessage('before first compact'),
      compactBoundary('first summary'),
      userMessage('between compact boundaries'),
      compactBoundary('latest summary'),
      afterLatest,
    ]

    const scope = getMessagesAfterLatestCompactBoundary(messages)

    expect(scope.boundaryIndex).toBe(3)
    expect(scope.summary).toBe('latest summary')
    expect(scope.messages).toEqual([afterLatest])
  })

  test('given prior compact boundary and transient stream messages when summarizing then includes only durable post-boundary context', () => {
    const summary = buildManagedCompactSummary([
      userMessage('old request before compact'),
      compactBoundary('saved summary'),
      userMessage('new user request'),
      assistantMessage([{ type: 'text', text: 'transient partial answer' }], { transient: true }),
      assistantMessage([{ type: 'text', text: 'durable assistant answer' }]),
    ])

    expect(summary).toContain('Mroma 托管式上下文压缩摘要')
    expect(summary).toContain('压缩范围：最近 2 条有效消息')
    expect(summary).toContain('[user] new user request')
    expect(summary).toContain('[assistant] durable assistant answer')
    expect(summary).not.toContain('old request before compact')
    expect(summary).not.toContain('transient partial answer')
  })

  test('given tool content when summarizing then records compact tool snippets', () => {
    const summary = buildManagedCompactSummary([
      assistantMessage([
        {
          type: 'tool_use',
          name: 'Bash',
          input: { command: 'bun test apps/electron/src/main/lib/agent-managed-compact.test.ts' },
        },
      ]),
      userMessage('tool result placeholder'),
      assistantMessage([{ type: 'thinking', thinking: 'checking compact boundary behavior' }]),
      userMessage('x'.repeat(1_000)),
    ])

    expect(summary).toContain('[tool_use] Bash: bun test apps/electron/src/main/lib/agent-managed-compact.test.ts')
    expect(summary).toContain('[reasoning] checking compact boundary behavior')
    expect(summary).toContain(`${'x'.repeat(900)}...`)
    expect(summary.length).toBeLessThanOrEqual(12_000)
  })
})
