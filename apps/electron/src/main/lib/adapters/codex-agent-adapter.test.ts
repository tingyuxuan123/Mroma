import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKAssistantMessage, SDKMessageMetadata, SDKUserMessage } from '@mroma/shared'
import { formatCodexExecutionError, isCodexBinaryResolutionError, resolveCodexBinaryFromPath } from '../codex-cli-resolver'
import { buildCodexConfig, buildCodexContextUsage, buildCodexTurnUsage, convertCodexItemToSDKMessages, extractAttachedImagePaths, inferCodexContextWindow, mapEffortToCodex, type CodexItem } from './codex-agent-adapter'

function firstAssistant(messages: unknown[]): SDKAssistantMessage {
  return messages.find((msg): msg is SDKAssistantMessage =>
    typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'assistant'
  )!
}

function firstToolResult(messages: unknown[]): SDKUserMessage {
  return messages.find((msg): msg is SDKUserMessage =>
    typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'user'
  )!
}

function firstContentBlock(message: SDKAssistantMessage | SDKUserMessage): Record<string, unknown> {
  const content = message.message?.content
  if (!Array.isArray(content) || !content[0] || typeof content[0] !== 'object') {
    throw new Error('missing first content block')
  }
  return content[0] as Record<string, unknown>
}

function metadata(message: unknown): Record<string, unknown> {
  return message as Record<string, unknown>
}

function streamMetadata(message: unknown): SDKMessageMetadata {
  const meta = metadata(message).metadata
  if (!meta || typeof meta !== 'object') throw new Error('missing metadata')
  return meta as SDKMessageMetadata
}

describe('Codex item 转换', () => {
  test('given command output when converting then preserves aggregated output', () => {
    const item: CodexItem = {
      id: 'cmd-1',
      type: 'command_execution',
      command: 'bun test',
      aggregated_output: 'all tests passed',
      exit_code: 0,
      status: 'completed',
    }

    const messages = convertCodexItemToSDKMessages(item)
    const assistant = firstAssistant(messages)
    const result = firstToolResult(messages)

    expect(firstContentBlock(assistant)).toMatchObject({
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'bun test' },
    })
    expect(firstContentBlock(result)).toMatchObject({
      type: 'tool_result',
      content: expect.stringContaining('all tests passed'),
      is_error: false,
    })
    expect(metadata(assistant)._codexTransient).toBeUndefined()
    expect(metadata(result)._codexTransient).toBeUndefined()
    expect(streamMetadata(assistant)).toMatchObject({
      backend: 'codex',
      streamingKey: 'codex:cmd-1:assistant',
      transient: false,
      itemStatus: 'completed',
      sourceEvent: 'item.completed',
    })
  })

  test('given started command when converting then emits transient tool start only', () => {
    const item: CodexItem = {
      id: 'cmd-live-1',
      type: 'command_execution',
      command: 'bun test',
      status: 'in_progress',
    }

    const messages = convertCodexItemToSDKMessages(item, { transient: true, includeToolResult: false })

    expect(messages).toHaveLength(1)
    expect(firstContentBlock(firstAssistant(messages))).toMatchObject({
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'bun test' },
    })
    expect(metadata(messages[0])._codexTransient).toBeUndefined()
    expect(metadata(messages[0])._codexStreamingKey).toBeUndefined()
    expect(streamMetadata(messages[0])).toMatchObject({
      backend: 'codex',
      streamingKey: 'codex:cmd-live-1:assistant',
      transient: true,
      itemStatus: 'started',
      sourceEvent: 'item.started',
    })
  })

  test('given updated command when converting then emits replaceable transient result', () => {
    const item: CodexItem = {
      id: 'cmd-live-2',
      type: 'command_execution',
      command: 'bun test',
      aggregated_output: 'running tests...',
      status: 'in_progress',
    }

    const messages = convertCodexItemToSDKMessages(item, { transient: true })
    const assistant = firstAssistant(messages)
    const result = firstToolResult(messages)

    expect(messages).toHaveLength(2)
    expect(metadata(assistant)._codexTransient).toBeUndefined()
    expect(metadata(result)._codexTransient).toBeUndefined()
    expect(streamMetadata(assistant)).toMatchObject({
      streamingKey: 'codex:cmd-live-2:assistant',
      transient: true,
      itemStatus: 'updated',
      sourceEvent: 'item.updated',
    })
    expect(streamMetadata(result)).toMatchObject({
      streamingKey: 'codex:cmd-live-2:result',
      transient: true,
      itemStatus: 'updated',
      sourceEvent: 'item.updated',
    })
    expect(firstContentBlock(result)).toMatchObject({
      type: 'tool_result',
      content: expect.stringContaining('running tests...'),
    })
  })

  test('given MCP failure when converting then uses server and tool fields', () => {
    const item: CodexItem = {
      id: 'mcp-1',
      type: 'mcp_tool_call',
      server: 'github',
      tool: 'list_issues',
      arguments: { repo: 'openai/codex' },
      status: 'failed',
      error: { message: 'rate limited' },
    }

    const messages = convertCodexItemToSDKMessages(item)
    const assistant = firstAssistant(messages)
    const result = firstToolResult(messages)

    expect(firstContentBlock(assistant)).toMatchObject({
      type: 'tool_use',
      name: 'github__list_issues',
    })
    expect(firstContentBlock(result)).toMatchObject({
      type: 'tool_result',
      content: 'rate limited',
      is_error: true,
    })
  })

  test('given todo list when converting then maps completed flags to task statuses', () => {
    const item: CodexItem = {
      id: 'todo-1',
      type: 'todo_list',
      items: [
        { text: '修复字段映射', completed: true },
        { text: '补充打包配置', completed: false },
      ],
    }

    const messages = convertCodexItemToSDKMessages(item)
    const result = firstToolResult(messages)
    const block = firstContentBlock(result)

    expect(block.type).toBe('tool_result')
    expect(block.is_error).toBe(false)
    expect(block.content).toContain('[completed] 修复字段映射')
    expect(block.content).toContain('[pending] 补充打包配置')
  })

  test('given unknown Codex item when converting then emits system fallback', () => {
    const item: CodexItem = {
      id: 'future-1',
      type: 'future_item',
      status: 'completed',
      message: 'new event shape',
    }

    const messages = convertCodexItemToSDKMessages(item)

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      type: 'system',
      subtype: 'codex_future_item',
      id: 'future-1',
      message: 'new event shape',
    })
    expect(streamMetadata(messages[0])).toMatchObject({
      backend: 'codex',
      streamingKey: 'codex:future-1:system',
      transient: false,
    })
  })
})

describe('Codex SDK 选项映射', () => {
  test('given max effort when mapping then uses Codex xhigh effort', () => {
    expect(mapEffortToCodex('max')).toBe('xhigh')
    expect(mapEffortToCodex('minimal')).toBe('minimal')
    expect(mapEffortToCodex('high')).toBe('high')
  })

  test('given fast mode when building config then passes Codex fast flags separately from effort', () => {
    expect(buildCodexConfig(true)).toEqual({
      service_tier: 'fast',
      fast_mode: true,
      features: { fast_mode: true },
    })
    expect(buildCodexConfig(false)).toBeUndefined()
  })

  test('given official Codex turn usage when mapping then does not subtract previous turns', () => {
    const usage = buildCodexTurnUsage(
      {
        input_tokens: 120_000,
        cached_input_tokens: 80_000,
        output_tokens: 5_000,
        reasoning_output_tokens: 2_000,
      },
    )

    expect(usage).toEqual({
      input_tokens: 40_000,
      cache_read_input_tokens: 80_000,
      output_tokens: 7_000,
    })
  })

  test('given official Codex usage when building context usage then marks it as estimated', () => {
    const usage = buildCodexContextUsage(
      {
        input_tokens: 120_000,
        cached_input_tokens: 80_000,
        output_tokens: 5_000,
        reasoning_output_tokens: 2_000,
      },
      { model: 'gpt-5-codex' },
    )

    expect(usage).toMatchObject({
      backend: 'codex',
      source: 'estimated',
      scope: 'turn',
      inputTokens: 120_000,
      cachedInputTokens: 80_000,
      outputTokens: 5_000,
      reasoningTokens: 2_000,
      estimatedActiveTokens: 127_000,
      contextWindow: 400_000,
      model: 'gpt-5-codex',
    })
  })

  test('given Codex model when inferring context then returns visible context window fallback', () => {
    expect(inferCodexContextWindow('gpt-5.1-codex')).toBe(400_000)
    expect(inferCodexContextWindow('gpt-5-codex', 1_000_000)).toBe(1_000_000)
    expect(inferCodexContextWindow('o4-mini')).toBe(200_000)
  })

  test('given attached image files when extracting then returns existing image paths only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mroma-codex-adapter-'))
    try {
      const imagePath = join(dir, 'screen.png')
      const textPath = join(dir, 'notes.txt')
      writeFileSync(imagePath, 'fake-image')
      writeFileSync(textPath, 'not-image')

      const prompt = `<attached_files>
- screen.png: ${imagePath}
- notes.txt: ${textPath}
- missing.jpg: ${join(dir, 'missing.jpg')}
</attached_files>

请查看附件。`

      expect(extractAttachedImagePaths(prompt)).toEqual([imagePath])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Codex CLI binary fallback', () => {
  test('given Codex SDK binary resolution error when checking then detects it', () => {
    expect(isCodexBinaryResolutionError(new Error('Unable to locate Codex CLI binaries. Ensure @openai/codex is installed with optional dependencies.'))).toBe(true)
    expect(isCodexBinaryResolutionError(new Error('network timeout'))).toBe(false)
  })

  test('given executable codex in PATH when resolving then returns the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mroma-codex-path-'))
    try {
      const binaryPath = join(dir, 'codex')
      writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n')
      chmodSync(binaryPath, 0o755)

      expect(resolveCodexBinaryFromPath({ PATH: dir }, 'linux')).toBe(binaryPath)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('given chat completions endpoint error when formatting then explains Responses requirement', () => {
    const formatted = formatCodexExecutionError(
      new Error('404 POST /v1/chat/completions not found'),
      { baseUrl: 'https://example.test/v1' },
    )

    expect(formatted).toContain('Responses API')
    expect(formatted).toContain('Chat Completions')
    expect(formatted).toContain('https://example.test/v1')
  })
})
