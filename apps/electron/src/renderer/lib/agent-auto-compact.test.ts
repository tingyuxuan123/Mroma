import { describe, expect, test } from 'bun:test'
import { normalizeAutoCompactThresholdPercent, shouldAutoCompactContext } from './agent-auto-compact'

describe('Agent 自动上下文压缩判定', () => {
  test('given usage reaches threshold when enabled then requests compaction', () => {
    expect(shouldAutoCompactContext({
      enabled: true,
      thresholdPercent: 78,
      inputTokens: 156_000,
      contextWindow: 200_000,
      resultSubtype: 'success',
    })).toBe(true)
  })

  test('given usage below threshold when enabled then skips compaction', () => {
    expect(shouldAutoCompactContext({
      enabled: true,
      thresholdPercent: 80,
      inputTokens: 120_000,
      contextWindow: 200_000,
      resultSubtype: 'success',
    })).toBe(false)
  })

  test('given failed or already compacting turn then skips compaction', () => {
    expect(shouldAutoCompactContext({
      enabled: true,
      inputTokens: 190_000,
      contextWindow: 200_000,
      resultSubtype: 'error_during_execution',
    })).toBe(false)

    expect(shouldAutoCompactContext({
      enabled: true,
      inputTokens: 190_000,
      contextWindow: 200_000,
      resultSubtype: 'success',
      compactInFlight: true,
    })).toBe(false)
  })

  test('given invalid threshold then clamps to supported range', () => {
    expect(normalizeAutoCompactThresholdPercent(undefined)).toBe(78)
    expect(normalizeAutoCompactThresholdPercent(-1)).toBe(1)
    expect(normalizeAutoCompactThresholdPercent(120)).toBe(100)
  })
})
