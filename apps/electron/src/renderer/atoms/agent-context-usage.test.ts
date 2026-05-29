import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@mroma/shared'
import { applyAgentEvent, extractAgentContextStatusFromSDKMessages, type AgentStreamState } from './agent-atoms'
import { getPureInputTokens } from '../lib/agent-usage-format'

function createRunningState(overrides: Partial<AgentStreamState> = {}): AgentStreamState {
  return {
    running: true,
    content: '',
    toolActivities: [],
    ...overrides,
  }
}

describe('Agent 上下文用量指示器状态', () => {
  test('given cache read tokens are larger than live input when formatting then does not subtract cache from input', () => {
    expect(getPureInputTokens(27_430, 408_064)).toBe(27_430)
  })

  test('given streaming usage exists when result usage arrives then keeps latest model-call window usage', () => {
    const previous = createRunningState({
      inputTokens: 12_000,
      outputTokens: 600,
      cacheReadTokens: 4_000,
      cacheCreationTokens: 1_000,
      contextWindow: 200_000,
    })

    const next = applyAgentEvent(previous, {
      type: 'complete',
      stopReason: 'end_turn',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 8_000,
        cacheReadTokens: 900_000,
        cacheCreationTokens: 50_000,
        costUsd: 0.42,
        contextWindow: 1_000_000,
      },
    })

    expect(next.inputTokens).toBe(12_000)
    expect(next.outputTokens).toBe(600)
    expect(next.cacheReadTokens).toBe(4_000)
    expect(next.cacheCreationTokens).toBe(1_000)
    expect(next.costUsd).toBe(0.42)
    expect(next.contextWindow).toBe(1_000_000)
  })

  test('given partial streaming usage when result usage arrives then does not mix aggregate cache details', () => {
    const next = applyAgentEvent(createRunningState({ inputTokens: 12_000 }), {
      type: 'complete',
      stopReason: 'end_turn',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 8_000,
        cacheReadTokens: 900_000,
        cacheCreationTokens: 50_000,
        contextWindow: 1_000_000,
      },
    })

    expect(next.inputTokens).toBe(12_000)
    expect(next.outputTokens).toBeUndefined()
    expect(next.cacheReadTokens).toBeUndefined()
    expect(next.cacheCreationTokens).toBeUndefined()
    expect(next.contextWindow).toBe(1_000_000)
  })

  test('given no streaming usage when result usage arrives then fills usage as fallback', () => {
    const next = applyAgentEvent(createRunningState(), {
      type: 'complete',
      stopReason: 'end_turn',
      usage: {
        inputTokens: 32_000,
        outputTokens: 1_200,
        cacheReadTokens: 20_000,
        cacheCreationTokens: 4_000,
        contextWindow: 200_000,
      },
    })

    expect(next.inputTokens).toBe(32_000)
    expect(next.outputTokens).toBe(1_200)
    expect(next.cacheReadTokens).toBe(20_000)
    expect(next.cacheCreationTokens).toBe(4_000)
    expect(next.contextWindow).toBe(200_000)
  })

  test('given codex estimated context usage when result usage arrives then stores estimated metadata', () => {
    const next = applyAgentEvent(createRunningState(), {
      type: 'complete',
      stopReason: 'end_turn',
      usage: {
        inputTokens: 120_000,
        outputTokens: 5_000,
        reasoningTokens: 2_000,
        cacheReadTokens: 80_000,
        contextWindow: 400_000,
        estimatedActiveTokens: 127_000,
        backend: 'codex',
        source: 'estimated',
        scope: 'turn',
      },
    })

    expect(next.inputTokens).toBe(120_000)
    expect(next.outputTokens).toBe(5_000)
    expect(next.reasoningTokens).toBe(2_000)
    expect(next.cacheReadTokens).toBe(80_000)
    expect(next.contextWindow).toBe(400_000)
    expect(next.estimatedActiveTokens).toBe(127_000)
    expect(next.contextUsageBackend).toBe('codex')
    expect(next.contextUsageSource).toBe('estimated')
    expect(next.contextUsageScope).toBe('turn')
  })

  test('given compact is running when compact fails then clears compact flags and stops stream', () => {
    const next = applyAgentEvent(createRunningState({
      isCompacting: true,
      compactInFlight: true,
    }), {
      type: 'compact_failed',
      message: '摘要生成失败',
    })

    expect(next.running).toBe(false)
    expect(next.isCompacting).toBe(false)
    expect(next.compactInFlight).toBe(false)
  })

  test('given persisted Codex result when restoring history then exposes latest context usage', () => {
    const messages = [{
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 40_000, output_tokens: 2_000, cache_read_input_tokens: 20_000 },
      contextUsage: {
        backend: 'codex',
        source: 'estimated',
        scope: 'turn',
        inputTokens: 40_000,
        cachedInputTokens: 20_000,
        outputTokens: 2_000,
        reasoningTokens: 1_000,
        estimatedActiveTokens: 43_000,
        contextWindow: 200_000,
      },
    }] satisfies SDKMessage[]

    const status = extractAgentContextStatusFromSDKMessages(messages)

    expect(status.inputTokens).toBe(40_000)
    expect(status.outputTokens).toBe(2_000)
    expect(status.reasoningTokens).toBe(1_000)
    expect(status.cacheReadTokens).toBe(20_000)
    expect(status.estimatedActiveTokens).toBe(43_000)
    expect(status.contextWindow).toBe(200_000)
    expect(status.contextUsageBackend).toBe('codex')
    expect(status.contextUsageSource).toBe('estimated')
    expect(status.contextUsageScope).toBe('turn')
  })

  test('given persisted compact boundary when restoring history then keeps zero-token reset state visible', () => {
    const messages = [{
      type: 'system',
      subtype: 'compact_boundary',
      metadata: { backend: 'codex' },
    }] satisfies SDKMessage[]

    const status = extractAgentContextStatusFromSDKMessages(messages)

    expect(status.inputTokens).toBe(0)
    expect(status.estimatedActiveTokens).toBe(0)
    expect(status.contextUsageBackend).toBe('codex')
    expect(status.contextUsageSource).toBe('estimated')
    expect(status.contextUsageScope).toBe('active_context')
  })

  test('given empty history when restoring usage then returns empty non-compacting state', () => {
    const status = extractAgentContextStatusFromSDKMessages([])

    expect(status).toEqual({ isCompacting: false })
  })

  test('given multiple persisted results when restoring history then uses the latest result', () => {
    const messages = [
      {
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 10_000, output_tokens: 500 },
        contextUsage: {
          backend: 'claude',
          source: 'sdk',
          scope: 'turn',
          inputTokens: 10_000,
          outputTokens: 500,
          contextWindow: 200_000,
        },
      },
      {
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 90_000, output_tokens: 4_000 },
        contextUsage: {
          backend: 'codex',
          source: 'estimated',
          scope: 'turn',
          inputTokens: 90_000,
          outputTokens: 4_000,
          estimatedActiveTokens: 94_000,
          contextWindow: 400_000,
        },
      },
    ] satisfies SDKMessage[]

    const status = extractAgentContextStatusFromSDKMessages(messages)

    expect(status.inputTokens).toBe(90_000)
    expect(status.outputTokens).toBe(4_000)
    expect(status.estimatedActiveTokens).toBe(94_000)
    expect(status.contextWindow).toBe(400_000)
    expect(status.contextUsageBackend).toBe('codex')
    expect(status.contextUsageSource).toBe('estimated')
  })

  test('given persisted result without contextUsage when restoring history then falls back to result usage', () => {
    const messages = [{
      type: 'result',
      subtype: 'success',
      usage: {
        input_tokens: 50_000,
        output_tokens: 3_000,
        cache_read_input_tokens: 30_000,
        cache_creation_input_tokens: 5_000,
      },
      modelUsage: {
        stale: { contextWindow: 100_000 },
        latest: { contextWindow: 300_000 },
      },
      metadata: { backend: 'claude' },
    }] satisfies SDKMessage[]

    const status = extractAgentContextStatusFromSDKMessages(messages)

    expect(status.inputTokens).toBe(50_000)
    expect(status.outputTokens).toBe(3_000)
    expect(status.cacheReadTokens).toBe(30_000)
    expect(status.cacheCreationTokens).toBe(5_000)
    expect(status.contextWindow).toBe(300_000)
    expect(status.contextUsageBackend).toBe('claude')
    expect(status.contextUsageSource).toBe('sdk')
    expect(status.contextUsageScope).toBe('turn')
  })

  test('given fallback result has empty modelUsage when restoring history then leaves context window undefined', () => {
    const messages = [{
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 8_000, output_tokens: 600 },
      modelUsage: {},
    }] satisfies SDKMessage[]

    const status = extractAgentContextStatusFromSDKMessages(messages)

    expect(status.inputTokens).toBe(8_000)
    expect(status.outputTokens).toBe(600)
    expect(status.contextWindow).toBeUndefined()
  })
})
