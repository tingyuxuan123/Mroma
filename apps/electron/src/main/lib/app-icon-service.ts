import { app, nativeImage, type App as ElectronApp, type BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { AppSettings } from '../../types'

export const LINUX_DESKTOP_FILE_NAME = 'mroma.desktop'
export const LINUX_DEV_DESKTOP_FILE_NAME = 'mroma-dev.desktop'
export const LINUX_STARTUP_WM_CLASS = 'Mroma'
export const LINUX_DEV_STARTUP_WM_CLASS = 'MromaDev'

const DEFAULT_APP_ICON_VARIANT = 'default'
const LINUX_DEV_ICON_NAME = 'mroma-dev'
const LINUX_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024] as const

/**
 * 配置 Linux 桌面环境用于匹配 .desktop 启动器的应用身份。
 * 该配置必须在创建 BrowserWindow 之前完成，否则 GNOME/KDE 可能回退到 Electron 默认图标。
 */
export function configureLinuxDesktopIdentity(): void {
  if (process.platform !== 'linux') return

  const startupWmClass = app.isPackaged ? LINUX_STARTUP_WM_CLASS : LINUX_DEV_STARTUP_WM_CLASS
  const desktopFileName = app.isPackaged ? LINUX_DESKTOP_FILE_NAME : LINUX_DEV_DESKTOP_FILE_NAME

  if (!app.isPackaged) {
    ensureLinuxDevDesktopEntry()
  }

  app.setName(startupWmClass)

  const linuxApp = app as ElectronApp & { setDesktopName?: (name: string) => void }
  linuxApp.setDesktopName?.(desktopFileName)
}

function ensureLinuxDevDesktopEntry(): void {
  try {
    const resourcesDir = getBundledResourcesDir()
    const localShareDir = join(homedir(), '.local', 'share')
    const desktopFilePath = join(localShareDir, 'applications', LINUX_DEV_DESKTOP_FILE_NAME)
    const hasThemeIcon = installLinuxDevThemeIcons(localShareDir, resourcesDir)
    const iconValue = hasThemeIcon ? LINUX_DEV_ICON_NAME : join(resourcesDir, 'icon.png')
    const exec = `${quoteDesktopExecArg(process.execPath)} ${quoteDesktopExecArg(process.cwd())}`

    mkdirSync(dirname(desktopFilePath), { recursive: true })
    writeFileSync(
      desktopFilePath,
      [
        '[Desktop Entry]',
        'Name=Mroma Dev',
        'Comment=Mroma development build',
        `Exec=${exec}`,
        'Terminal=false',
        'Type=Application',
        `Icon=${iconValue}`,
        `StartupWMClass=${LINUX_DEV_STARTUP_WM_CLASS}`,
        'Categories=Development;',
        'NoDisplay=true',
        '',
      ].join('\n'),
      'utf-8',
    )
  } catch (error) {
    console.warn('[图标] 写入 Linux 开发模式 .desktop 失败:', error)
  }
}

function installLinuxDevThemeIcons(localShareDir: string, resourcesDir: string): boolean {
  let installed = false

  for (const size of LINUX_ICON_SIZES) {
    const source = join(resourcesDir, 'icons', `${size}x${size}.png`)
    if (!existsSync(source)) continue

    const targetDir = join(localShareDir, 'icons', 'hicolor', `${size}x${size}`, 'apps')
    mkdirSync(targetDir, { recursive: true })
    copyFileSync(source, join(targetDir, `${LINUX_DEV_ICON_NAME}.png`))
    installed = true
  }

  return installed
}

function quoteDesktopExecArg(value: string): string {
  return '"' + value.replace(/["\\$`]/g, '\\$&') + '"'
}

/**
 * 打包内置资源目录。
 * dev: __dirname/resources（build:resources 阶段拷贝）
 * prod: process.resourcesPath（electron-builder extraResources 产物）
 */
export function getBundledResourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, 'resources')
}

/** 解析应用图标变体的 PNG 文件路径。 */
export function resolveAppIconPath(variantId?: string | null): string {
  const resourcesDir = getBundledResourcesDir()
  const normalizedVariantId = variantId?.trim() || DEFAULT_APP_ICON_VARIANT

  if (normalizedVariantId === DEFAULT_APP_ICON_VARIANT) {
    return join(resourcesDir, 'icon.png')
  }

  return join(resourcesDir, 'mroma-logos', `mroma-${normalizedVariantId}.png`)
}

/** 解析 BrowserWindow 初始化时应使用的平台图标。 */
export function resolveWindowIconPath(settings?: Pick<AppSettings, 'appIconVariant'>): string {
  const resourcesDir = getBundledResourcesDir()

  if (process.platform === 'darwin') {
    return join(resourcesDir, 'icon.icns')
  }

  if (process.platform === 'win32') {
    return join(resourcesDir, 'icon.ico')
  }

  const preferredIconPath = resolveAppIconPath(settings?.appIconVariant)
  if (existsSync(preferredIconPath)) return preferredIconPath

  return join(resourcesDir, 'icon.png')
}

/**
 * Linux 支持运行时更新窗口图标，任务栏/Dock 会优先读取当前窗口 icon。
 */
export function applyLinuxWindowIcon(win: BrowserWindow, variantId?: string | null): boolean {
  if (process.platform !== 'linux') return false

  const iconPath = resolveAppIconPath(variantId)
  if (!existsSync(iconPath)) return false

  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) return false

  win.setIcon(image)
  return true
}
