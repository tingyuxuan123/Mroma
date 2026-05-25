import { describe, expect, test } from 'bun:test'
import { applyAgentEvent, type AgentStreamState } from './agent-atoms'

function createRunningState(overrides: Partial<AgentStreamState> = {}): AgentStreamState {
  return {
    running: true,
    content: '',
    toolActivities: [],
    ...overrides,
  }
}

describe('Agent 上下文用量指示器状态', () => {
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
})
