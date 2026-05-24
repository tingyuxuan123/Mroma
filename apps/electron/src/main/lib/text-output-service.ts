/**
 * 文本输出服务
 *
 * 语音输入完成后优先写入 Mroma 输入框，否则尝试写入当前光标位置。
 */

import { BrowserWindow, clipboard } from 'electron'
import { VOICE_DICTATION_IPC_CHANNELS } from '../../types'
import type { VoiceDictationCommitResult, VoiceDictationSettings } from '../../types'
import { getMainWindow } from '../index'
import { pasteTextAtCurrentCursor } from './text-insertion-service'

let targetWasMromaInput = false

/** 在显示语音浮窗前记录目标是否为 Mroma 主窗口。 */
export function captureVoiceDictationTarget(forceMromaInput?: boolean): boolean {
  const mainWindow = getMainWindow()
  targetWasMromaInput = forceMromaInput ?? BrowserWindow.getFocusedWindow() === mainWindow
  return targetWasMromaInput
}

export async function commitVoiceDictationText(
  text: string,
  settings: VoiceDictationSettings,
): Promise<VoiceDictationCommitResult> {
  const trimmed = text.trim()
  if (!trimmed) {
    return { mode: 'clipboard', success: false, message: '没有可输出的语音文本' }
  }

  const mainWindow = getMainWindow()
  const shouldWriteMroma =
    settings.outputMode === 'mroma-input' ||
    (settings.outputMode === 'auto' && targetWasMromaInput)

  if (shouldWriteMroma && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(VOICE_DICTATION_IPC_CHANNELS.INSERT_TEXT, { text: trimmed })
    return { mode: 'mroma-input', success: true, message: '已写入 Mroma 输入框' }
  }

  if (settings.outputMode === 'auto') {
    const result = await pasteTextAtCurrentCursor(trimmed)
    return result.success
      ? { mode: 'cursor', success: true, message: result.message }
      : { mode: 'clipboard', success: true, message: result.message }
  }

  clipboard.writeText(trimmed)
  return { mode: 'clipboard', success: true, message: '已复制到剪贴板' }
}
