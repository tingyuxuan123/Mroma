/**
 * 跨平台清理残留的 electronmon / electron 进程
 * 替代 pkill（Windows 不支持）
 */
import { execSync } from 'child_process'

const isWin = process.platform === 'win32'

function getAncestorPids(): Set<number> {
  const ancestors = new Set<number>([process.pid])
  let current = process.ppid

  while (current > 1 && !ancestors.has(current)) {
    ancestors.add(current)
    try {
      const parent = Number(execSync(`ps -o ppid= -p ${current}`, { encoding: 'utf8' }).trim())
      if (!Number.isFinite(parent)) break
      current = parent
    } catch {
      break
    }
  }

  return ancestors
}

function killUnix(pattern: RegExp): void {
  const ancestors = getAncestorPids()
  const output = execSync('ps -eo pid=,args=', { encoding: 'utf8' })

  for (const line of output.split('\n')) {
    const match = line.trimStart().match(/^(\d+)\s+(.+)$/)
    if (!match) continue

    const pid = Number(match[1])
    const command = match[2]!
    if (!Number.isFinite(pid) || ancestors.has(pid) || !pattern.test(command)) continue

    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // 进程可能已退出或无权限，忽略
    }
  }
}

function kill(pattern: string): void {
  try {
    if (isWin) {
      // Windows: taskkill 按进程名
      execSync(`taskkill /F /IM ${pattern} 2>nul`, { stdio: 'ignore' })
    } else {
      // Unix: 避免 pkill -f 误杀包含 "electronmon ." 的当前 dev 命令链。
      killUnix(new RegExp(pattern))
    }
  } catch {
    // 没有匹配进程，忽略
  }
}

kill(isWin ? 'electronmon.exe' : 'electronmon \\.')
kill(isWin ? 'electron.exe' : 'electron.*dist/main')
