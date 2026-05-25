import { describe, expect, test } from 'bun:test'
import type { SDKSystemMessage } from '@mroma/shared'
import { buildCompactBoundaryViewModel, buildCompactFailedViewModel, formatCompactBoundaryTime, getCompactReasonLabel } from './compact-boundary-view'

function compactBoundary(overrides: Record<string, unknown>): SDKSystemMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    ...overrides,
  } as unknown as SDKSystemMessage
}

describe('compact boundary 展示模型', () => {
  test('given Codex managed compact boundary when building view model then explains new thread summary semantics', () => {
    const view = buildCompactBoundaryViewModel(compactBoundary({
      summary: '保留的压缩摘要',
      reason: 'auto',
      compacted_at: '2026-05-25T12:34:56.000Z',
      old_sdk_session_id: 'thread-old-1',
      metadata: { backend: 'codex' },
    }))

    expect(view.summary).toBe('保留的压缩摘要')
    expect(view.reasonLabel).toBe('自动触发')
    expect(view.backendLabel).toBe('Codex 托管式压缩')
    expect(view.compactedAtLabel).toBe('2026-05-25 12:34')
    expect(view.oldSdkSessionId).toBe('thread-old-1')
    expect(view.description).toContain('旧 Codex thread 已重置')
    expect(view.description).toContain('完整历史仍保留')
  })

  test('given legacy compact boundary without summary when building view model then keeps divider-only fallback safe', () => {
    const view = buildCompactBoundaryViewModel(compactBoundary({
      summary: '   ',
      reason: 'unknown',
      compacted_at: 'not-a-date',
      metadata: { backend: 'claude' },
    }))

    expect(view.summary).toBeUndefined()
    expect(view.reasonLabel).toBeUndefined()
    expect(view.backendLabel).toBe('Claude 原生压缩')
    expect(view.compactedAtLabel).toBe('not-a-date')
    expect(view.description).toContain('旧上下文已被压缩为摘要')
  })

  test('given Codex managed compact failure when building view model then explains old thread remains usable', () => {
    const view = buildCompactFailedViewModel(compactBoundary({
      subtype: 'compact_failed',
      message: '摘要生成失败',
      reason: 'manual',
      failed_at: '2026-05-25T13:20:00.000Z',
      old_sdk_session_id: 'thread-still-usable',
      metadata: { backend: 'codex' },
    }))

    expect(view.errorMessage).toBe('摘要生成失败')
    expect(view.reasonLabel).toBe('手动触发')
    expect(view.backendLabel).toBe('Codex 托管式压缩')
    expect(view.failedAtLabel).toBe('2026-05-25 13:20')
    expect(view.oldSdkSessionId).toBe('thread-still-usable')
    expect(view.description).toContain('Codex thread 未被重置')
    expect(view.description).toContain('原会话上下文仍保持可用')
  })

  test('given compact failure without message when building view model then uses safe fallback copy', () => {
    const view = buildCompactFailedViewModel(compactBoundary({
      subtype: 'compact_failed',
      message: '   ',
      metadata: { backend: 'claude' },
    }))

    expect(view.errorMessage).toBe('压缩上下文失败，请稍后重试。')
    expect(view.description).toContain('原会话上下文仍保持可用')
  })

  test('given compact reason and time inputs when formatting then returns stable labels', () => {
    expect(getCompactReasonLabel('manual')).toBe('手动触发')
    expect(getCompactReasonLabel('prompt_too_long')).toBe('上下文过长')
    expect(getCompactReasonLabel('other')).toBeUndefined()
    expect(formatCompactBoundaryTime(undefined)).toBeUndefined()
    expect(formatCompactBoundaryTime('2026-05-25T01:02:03.000Z')).toBe('2026-05-25 01:02')
  })
})
