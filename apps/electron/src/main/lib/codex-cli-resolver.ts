import { accessSync, constants } from 'node:fs'
import path from 'node:path'

const CODEX_BINARY_MISSING_PATTERNS = [
  'unable to locate codex cli binaries',
  'unable to locate codex cli binaries for',
  'ensure @openai/codex is installed',
  'unsupported platform:',
  'unsupported target triple:',
]

/** 判断错误是否来自 Codex SDK 默认 native binary 解析失败。 */
export function isCodexBinaryResolutionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return CODEX_BINARY_MISSING_PATTERNS.some((pattern) => normalized.includes(pattern))
}

function canExecute(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function candidateNames(platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return ['codex']
  const names = ['codex.exe', 'codex.cmd', 'codex.bat', 'codex']
  return Array.from(new Set(names))
}

/**
 * 从 PATH 中解析用户安装的 codex CLI，用于 @openai/codex 包内 binary 缺失时 fallback。
 */
export function resolveCodexBinaryFromPath(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const pathValue = env.PATH ?? env.Path ?? env.path
  if (!pathValue) return undefined

  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue
    for (const name of candidateNames(platform)) {
      const candidate = path.join(dir, name)
      if (canExecute(candidate)) return candidate
    }
  }
  return undefined
}

export interface CodexErrorContext {
  baseUrl?: string
  resumeSessionId?: string
}

/** 将常见 Codex SDK/CLI 错误转换成更适合用户的说明。 */
export function formatCodexExecutionError(error: unknown, context: CodexErrorContext = {}): string {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw.toLowerCase()

  if (isCodexBinaryResolutionError(error)) {
    return `无法定位 Codex CLI binary：请确认应用依赖完整，或在 PATH 中安装 codex。原始错误：${raw}`
  }

  if (message.includes('401') || message.includes('unauthorized') || message.includes('invalid api key')) {
    return `OpenAI API Key 无效或无权限：请检查渠道设置中的 API Key。原始错误：${raw}`
  }

  if (message.includes('404') || message.includes('/v1/chat/completions') || message.includes('chat completions')) {
    return `Codex Agent 需要 Responses API 兼容端点。只支持 Chat Completions 的端点请用于 Chat 模式，或通过 Responses-to-Chat proxy 适配。${context.baseUrl ? `当前 baseUrl：${context.baseUrl}。` : ''}原始错误：${raw}`
  }

  if (message.includes('resume') || message.includes('thread') || message.includes('session')) {
    return `${context.resumeSessionId ? `恢复 Codex thread ${context.resumeSessionId} 失败` : '恢复 Codex thread 失败'}：可以清除会话 SDK session 后重试。原始错误：${raw}`
  }

  if (message.includes('permission') || message.includes('sandbox') || message.includes('approval')) {
    return `Codex 沙箱或权限策略执行失败：请检查当前权限模式和工作目录权限。原始错误：${raw}`
  }

  if (message.includes('enoent') || message.includes('no such file or directory')) {
    return `Codex 执行环境缺少必要文件或工作目录不存在：请检查工作区路径和 PATH。原始错误：${raw}`
  }

  if (message.includes('network') || message.includes('timeout') || message.includes('econn')) {
    return `Codex 网络请求失败：请检查代理、网络或 baseUrl 配置。原始错误：${raw}`
  }

  return raw
}
