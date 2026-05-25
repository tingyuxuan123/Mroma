import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKAssistantMessage, SDKUserMessage } from '@mroma/shared'
import { buildCodexConfig, buildCodexTurnUsage, convertCodexItemToSDKMessages, extractAttachedImagePaths, mapEffortToCodex, type CodexItem } from './codex-agent-adapter'

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
    expect(metadata(messages[0])._codexTransient).toBe(true)
    expect(metadata(messages[0])._codexStreamingKey).toBe('codex:cmd-live-1:assistant')
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
    expect(metadata(assistant)._codexTransient).toBe(true)
    expect(metadata(result)._codexTransient).toBe(true)
    expect(metadata(assistant)._codexStreamingKey).toBe('codex:cmd-live-2:assistant')
    expect(metadata(result)._codexStreamingKey).toBe('codex:cmd-live-2:result')
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

  test('given cumulative Codex usage when previous usage exists then maps to turn usage delta', () => {
    const usage = buildCodexTurnUsage(
      {
        input_tokens: 120_000,
        cached_input_tokens: 80_000,
        output_tokens: 5_000,
        reasoning_output_tokens: 2_000,
      },
      {
        input_tokens: 40_000,
        cached_input_tokens: 20_000,
        output_tokens: 1_500,
        reasoning_output_tokens: 500,
      },
    )

    expect(usage).toEqual({
      input_tokens: 20_000,
      cache_read_input_tokens: 60_000,
      output_tokens: 5_000,
    })
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
