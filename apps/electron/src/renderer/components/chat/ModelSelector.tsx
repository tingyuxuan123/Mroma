/**
 * ModelSelector - 模型选择器（Popover 样式）
 *
 * 现代化设计：
 * - Popover 弹出，轻量不遮挡
 * - 按渠道分组，灰色背景供应商标题行
 * - 选中项左侧绿色竖条高亮
 * - 触发按钮：模型 logo + 模型名 + [effort 徽章] + Chevron
 * - Agent 模式下内部集成 Reasoning 下拉 + Fast 开关
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { ChevronDown, Cpu, Search, Plus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { conversationsAtom, selectedModelAtom, channelsAtom, channelsLoadedAtom } from '@/atoms/chat-atoms'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { useConversationModelOptional } from '@/hooks/useConversationSettings'
import { useConversationIdOptional } from '@/contexts/session-context'
import { getModelLogo, getChannelLogo } from '@/lib/model-logo'
import { cn } from '@/lib/utils'
import type { Channel, ModelOption, AgentEffort } from '@mroma/shared'
import { isAgentCompatibleProvider } from '@mroma/shared'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const AGENT_EFFORT_OPTIONS: Array<{ value: AgentEffort; label: string }> = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
]

const EFFORT_BADGE_LABELS: Record<string, string> = {
  minimal: 'Min',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  max: 'Max',
}

/** 从渠道列表构建扁平化的模型选项 */
function buildModelOptions(
  channels: Channel[],
  filterChannelId?: string,
  filterChannelIds?: string[],
  agentOnly?: boolean,
): ModelOption[] {
  const options: ModelOption[] = []

  for (const channel of channels) {
    if (!channel.enabled) continue
    if (filterChannelId && channel.id !== filterChannelId) continue
    if (filterChannelIds && filterChannelIds.length > 0 && !filterChannelIds.includes(channel.id)) continue
    // Agent 模式：兜底过滤掉不兼容 Agent 的 provider（如 openai-chat / 智谱 / 豆包 / 通义 / google）。
    // 即便用户在白名单里手滑勾上了，这里也不允许选；防止跑出 Codex/Claude SDK 永远跑不通的渠道。
    if (agentOnly && !isAgentCompatibleProvider(channel.provider)) continue

    for (const model of channel.models) {
      if (!model.enabled) continue

      options.push({
        channelId: channel.id,
        channelName: channel.name,
        modelId: model.id,
        modelName: model.name,
        provider: channel.provider,
      })
    }
  }

  return options
}

/** 按渠道分组模型选项 */
function groupByChannel(options: ModelOption[]): Map<string, ModelOption[]> {
  const groups = new Map<string, ModelOption[]>()

  for (const option of options) {
    const key = option.channelId
    const group = groups.get(key) ?? []
    group.push(option)
    groups.set(key, group)
  }

  return groups
}

function getModelReasoningEffort(channels: Channel[], channelId: string): AgentEffort | undefined {
  const channel = channels.find((c) => c.id === channelId)
  return channel?.models[0]?.advancedConfig?.reasoningEffort
}

interface ModelSelectorProps {
  filterChannelId?: string
  filterChannelIds?: string[]
  agentOnly?: boolean
  externalSelectedModel?: { channelId: string; modelId: string } | null
  onModelSelect?: (option: ModelOption) => void
  effort?: AgentEffort
  onEffortChange?: (effort: AgentEffort) => void
  fastMode?: boolean
  onFastModeChange?: (fast: boolean) => void
  isCodexChannel?: boolean
}

export function ModelSelector({
  filterChannelId,
  filterChannelIds,
  agentOnly,
  externalSelectedModel,
  onModelSelect,
  effort,
  onEffortChange,
  fastMode,
  onFastModeChange,
  isCodexChannel,
}: ModelSelectorProps = {}): React.ReactElement {
  const [conversationModel, setConversationModel] = useConversationModelOptional()
  const conversationId = useConversationIdOptional()
  const setConversations = useSetAtom(conversationsAtom)
  const setGlobalModel = useSetAtom(selectedModelAtom)
  const channels = useAtomValue(channelsAtom)
  const channelsLoaded = useAtomValue(channelsLoadedAtom)
  const setChannels = useSetAtom(channelsAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')

  const isAgentMode = effort !== undefined

  // 外部模型优先 → per-conversation 模型
  const selectedModel = externalSelectedModel !== undefined ? externalSelectedModel : conversationModel

  // 每次打开 Popover 时刷新渠道列表，确保最新
  React.useEffect(() => {
    if (open) {
      window.electronAPI.listChannels().then(setChannels).catch(console.error)
      setSearch('')
    }
  }, [open, setChannels])

  const modelOptions = React.useMemo(() => buildModelOptions(channels, filterChannelId, filterChannelIds, agentOnly), [channels, filterChannelId, filterChannelIds, agentOnly])
  const grouped = React.useMemo(() => groupByChannel(modelOptions), [modelOptions])

  // 搜索过滤
  const filteredGrouped = React.useMemo(() => {
    if (!search.trim()) return grouped

    const query = search.toLowerCase()
    const filtered = new Map<string, ModelOption[]>()

    for (const [channelId, options] of grouped.entries()) {
      const matchedOptions = options.filter(
        (o) =>
          o.modelName.toLowerCase().includes(query) ||
          o.channelName.toLowerCase().includes(query)
      )
      if (matchedOptions.length > 0) {
        filtered.set(channelId, matchedOptions)
      }
    }

    return filtered
  }, [grouped, search])

  // 扁平化过滤后的模型列表，用于键盘导航
  const flatOptions = React.useMemo(() => {
    const result: ModelOption[] = []
    for (const options of filteredGrouped.values()) {
      result.push(...options)
    }
    return result
  }, [filteredGrouped])

  // 键盘高亮索引
  const [highlightIndex, setHighlightIndex] = React.useState(-1)
  const itemRefs = React.useRef<Map<number, HTMLButtonElement>>(new Map())

  // 搜索变化时重置高亮
  React.useEffect(() => {
    setHighlightIndex(-1)
  }, [search])

  // 高亮项变化时滚动到可见区域
  React.useEffect(() => {
    if (highlightIndex < 0) return
    const el = itemRefs.current.get(highlightIndex)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex])

  // 查找当前选中的模型信息
  const currentModelInfo = React.useMemo(() => {
    if (!selectedModel) return null
    return modelOptions.find(
      (o) => o.channelId === selectedModel.channelId && o.modelId === selectedModel.modelId
    ) ?? null
  }, [selectedModel, modelOptions])

  // 保持上次有效的模型信息，避免渠道未加载时闪烁"选择模型"
  const stableModelInfoRef = React.useRef(currentModelInfo)
  if (currentModelInfo) stableModelInfoRef.current = currentModelInfo
  const displayModelInfo = currentModelInfo ?? stableModelInfoRef.current

  /** 选择模型并持久化到当前对话 */
  const handleSelect = (option: ModelOption): void => {
    if (onModelSelect) {
      onModelSelect(option)
      setOpen(false)
      return
    }

    // Chat 模式：写入 per-conversation Map + 同步全局默认值
    if (setConversationModel) {
      setConversationModel({ channelId: option.channelId, modelId: option.modelId })
    }
    setGlobalModel({ channelId: option.channelId, modelId: option.modelId })
    setOpen(false)

    // 将模型/渠道选择保存到当前对话元数据
    if (conversationId) {
      window.electronAPI
        .updateConversationModel(conversationId, option.modelId, option.channelId)
        .then((updated) => {
          setConversations((prev) =>
            prev.map((c) => (c.id === updated.id ? updated : c))
          )
        })
        .catch(console.error)
    }
  }

  /** 搜索框键盘导航 */
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (flatOptions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev < flatOptions.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev > 0 ? prev - 1 : flatOptions.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = flatOptions[highlightIndex >= 0 ? highlightIndex : 0]
      if (target) handleSelect(target)
    }
  }

  const handleAddModels = React.useCallback(() => {
    setSettingsTab('channels')
    setSettingsOpen(true)
  }, [setSettingsTab, setSettingsOpen])

  if (channelsLoaded && modelOptions.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1">
        <Cpu className="size-3.5" />
        <span>暂无可用模型</span>
      </div>
    )
  }

  const effortBadge = effort ? EFFORT_BADGE_LABELS[effort] ?? effort : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          {displayModelInfo ? (
            <img src={getModelLogo(displayModelInfo.modelId, displayModelInfo.provider)} alt={displayModelInfo.modelName} className="size-4 rounded object-cover" />
          ) : (
            <Cpu className="size-3.5" />
          )}
          <span className="max-w-[200px] truncate">
            {displayModelInfo ? displayModelInfo.modelName : '选择模型'}
          </span>
          {effortBadge && (
            <span className="text-[10px] text-muted-foreground/70 font-medium">{effortBadge}</span>
          )}
          <ChevronDown className="size-3" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[320px] p-0" side="top" align="start" sideOffset={4}>
        <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border/60">
          <Search className="size-4 text-muted-foreground/60 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search models..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            autoFocus
          />
        </div>

        <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
          {filteredGrouped.size === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">未找到模型</div>
          ) : (
            (() => {
              let flatIndex = 0
              return Array.from(filteredGrouped.entries()).map(([channelId, options]) => {
                return options.map((option) => {
                  const isSelected = selectedModel?.channelId === option.channelId && selectedModel?.modelId === option.modelId
                  const currentFlatIndex = flatIndex++
                  const isHighlighted = currentFlatIndex === highlightIndex
                  const modelEffort = isAgentMode ? getModelReasoningEffort(channels, option.channelId) : undefined
                  const modelEffortBadge = modelEffort ? EFFORT_BADGE_LABELS[modelEffort] ?? modelEffort : null
                  return (
                    <button
                      key={`${option.channelId}:${option.modelId}`}
                      ref={(el) => { if (el) itemRefs.current.set(currentFlatIndex, el); else itemRefs.current.delete(currentFlatIndex) }}
                      type="button"
                      onClick={() => handleSelect(option)}
                      onMouseEnter={() => setHighlightIndex(currentFlatIndex)}
                      className={cn(
                        'flex items-center gap-2.5 w-full px-3 py-1.5 text-left transition-colors',
                        'hover:bg-accent',
                        isHighlighted && 'bg-accent',
                        isSelected && 'bg-foreground/10 border-l-2 border-l-primary'
                      )}
                    >
                      <img src={getModelLogo(option.modelId, option.provider)} alt={option.modelName} className="size-4 rounded object-cover flex-shrink-0" />
                      <span className={cn('flex-1 text-sm truncate', isSelected ? 'font-medium text-foreground' : 'text-foreground/80')}>
                        {option.modelName}
                      </span>
                      {modelEffortBadge && (
                        <span className="text-[10px] text-muted-foreground/60 font-medium flex-shrink-0">{modelEffortBadge}</span>
                      )}
                    </button>
                  )
                })
              })
            })()
          )}
        </div>

        <div className="border-t border-border/60">
          <button type="button" onClick={handleAddModels} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Plus className="size-4" />
            <span>Add Models</span>
          </button>
        </div>

        {isAgentMode && (
          <>
            <div className="border-t border-border/60 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Reasoning</span>
                <Select value={effort} onValueChange={(v) => onEffortChange?.(v as AgentEffort)}>
                  <SelectTrigger className="h-7 w-[100px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGENT_EFFORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {isCodexChannel && (
              <div className="border-t border-border/60 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Options</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Fast</span>
                    <Switch
                      checked={fastMode ?? false}
                      onCheckedChange={onFastModeChange}
                      className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
