export const DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT = 78

export interface AutoCompactDecisionInput {
  enabled?: boolean
  thresholdPercent?: number
  inputTokens?: number
  contextWindow?: number
  stoppedByUser?: boolean
  resultSubtype?: string
  isCompacting?: boolean
  compactInFlight?: boolean
}

export function normalizeAutoCompactThresholdPercent(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT
  return Math.max(1, Math.min(100, Math.round(value)))
}

export function shouldAutoCompactContext(input: AutoCompactDecisionInput): boolean {
  if (input.enabled !== true) return false
  if (input.stoppedByUser || input.resultSubtype !== 'success') return false
  if (input.isCompacting || input.compactInFlight) return false
  if (!input.inputTokens || input.inputTokens <= 0) return false
  if (!input.contextWindow || input.contextWindow <= 0) return false

  const thresholdPercent = normalizeAutoCompactThresholdPercent(input.thresholdPercent)
  return (input.inputTokens / input.contextWindow) * 100 >= thresholdPercent
}
