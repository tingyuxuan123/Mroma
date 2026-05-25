import { describe, expect, test } from 'bun:test'
import { buildDynamicContext } from './agent-prompt-builder'

describe('Agent 动态上下文', () => {
  test('given accessible directories when building context then exposes absolute search roots', () => {
    const context = buildDynamicContext({
      agentCwd: '/tmp/mroma/session-a',
      accessibleDirectories: [
        '/tmp/mroma/workspace-files',
        '/home/yfdl/project/ylzx-app',
        '/home/yfdl/project/ylzx-app',
      ],
    })

    expect(context).toContain('<accessible_directories>')
    expect(context).toContain('优先在这些目录中使用绝对路径搜索')
    expect(context).toContain('- /tmp/mroma/workspace-files')
    expect(context).toContain('- /home/yfdl/project/ylzx-app')
    expect(context.match(/ylzx-app/g)?.length).toBe(1)
  })
})
