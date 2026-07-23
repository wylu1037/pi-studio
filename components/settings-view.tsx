'use client'

import { useEffect, useState } from 'react'
import {
  ChatsCircleIcon,
  DatabaseIcon,
  FileTextIcon,
  HardDrivesIcon,
  ArrowClockwiseIcon,
  MapPinIcon,
  PaperclipIcon,
  PuzzlePieceIcon,
  TerminalWindowIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { AvatarPresetPicker } from '@/components/avatar-preset-picker'
import { ChatAvatar, userAvatarPresets } from '@/components/chat-avatar'
import { MetricsSettings } from '@/components/metrics-settings'
import { PageHeader, Panel } from '@/components/pi-ui'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useProfileSettings } from '@/components/use-profile-settings'
import { showToast } from '@/lib/toast'
import type { StorageEntry, StorageStats } from '@/lib/storage/stats'

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const
type LogLevel = (typeof LOG_LEVELS)[number]

type LogSnapshot = {
  totalSize: number
  files: Array<{
    name: 'server.log' | 'main.log'
    path: string
    size: number
    content: string
    truncated: boolean
  }>
}

export function SettingsView({ storageStats }: { storageStats: StorageStats }) {
  const { userAvatar, setUserAvatar } = useProfileSettings()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Settings" subtitle="Manage your personal preferences and app data." />
      <Tabs defaultValue="Profile" className="min-h-0 flex-1 gap-0">
        <div className="overflow-x-auto border-b border-border px-4">
          <TabsList
            variant="line"
            aria-label="Settings sections"
            className="h-auto gap-0 p-0 group-data-horizontal/tabs:h-auto data-[variant=line]:gap-0"
          >
            {['Profile', 'System', 'Metrics', 'Storage'].map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="h-auto flex-none rounded-none border-0 px-4 py-2.5 font-mono text-xs tracking-wider text-muted-foreground uppercase after:bg-accent group-data-horizontal/tabs:after:bottom-0 hover:text-foreground data-active:text-foreground"
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <ScrollArea className="min-h-0 flex-1" viewportClassName="px-6 py-5">
          <TabsContent value="Profile" className="max-w-2xl">
            <Panel className="flex flex-col gap-5 p-5">
              <div className="flex items-center gap-3">
                <ChatAvatar preset={userAvatar} role="user" className="size-11" />
                <div>
                  <h2 className="text-sm font-semibold text-foreground">User avatar</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Personalize how your messages appear in chat. Stored locally on this device.
                  </p>
                </div>
              </div>
              <AvatarPresetPicker
                presets={userAvatarPresets}
                selected={userAvatar}
                role="user"
                onSelect={setUserAvatar}
              />
            </Panel>
          </TabsContent>
          <TabsContent value="Storage" className="w-full">
            <StorageDashboard stats={storageStats} />
          </TabsContent>
          <TabsContent value="System" className="max-w-4xl">
            <LoggingSettings />
          </TabsContent>
          <TabsContent value="Metrics" className="w-full">
            <MetricsSettings />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  )
}

function LoggingSettings() {
  const [level, setLevel] = useState<LogLevel>('info')
  const [logDirectory, setLogDirectory] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [logs, setLogs] = useState<LogSnapshot | null>(null)
  const [refreshingLogs, setRefreshingLogs] = useState(false)
  const [clearingLogs, setClearingLogs] = useState(false)

  const loadLogs = async () => {
    setRefreshingLogs(true)
    try {
      const response = await fetch('/api/settings/logging/output', { cache: 'no-store' })
      if (!response.ok) throw new Error('Unable to load application logs.')
      setLogs((await response.json()) as LogSnapshot)
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Application logs',
        message: error instanceof Error ? error.message : 'Unable to load application logs.',
      })
    } finally {
      setRefreshingLogs(false)
    }
  }

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const [settingsResponse, logsResponse] = await Promise.all([
          fetch('/api/settings/logging', { cache: 'no-store' }),
          fetch('/api/settings/logging/output', { cache: 'no-store' }),
        ])
        if (!settingsResponse.ok) throw new Error('Unable to load logging settings.')
        if (!logsResponse.ok) throw new Error('Unable to load application logs.')
        const settings = (await settingsResponse.json()) as {
          level: LogLevel
          logDirectory: string
        }
        const logSnapshot = (await logsResponse.json()) as LogSnapshot
        if (active) {
          setLevel(settings.level)
          setLogDirectory(settings.logDirectory)
          setLogs(logSnapshot)
        }
      } catch (error) {
        if (active) {
          showToast({
            tone: 'error',
            title: 'Logging settings',
            message: error instanceof Error ? error.message : 'Unable to load logging settings.',
          })
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  const changeLevel = async (nextLevel: LogLevel) => {
    const previousLevel = level
    setLevel(nextLevel)
    setSaving(true)
    try {
      const response = await fetch('/api/settings/logging', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: nextLevel }),
      })
      if (!response.ok) throw new Error('Unable to save the log level.')
      const settings = (await response.json()) as { level: LogLevel; logDirectory: string }
      setLevel(settings.level)
      setLogDirectory(settings.logDirectory)
    } catch (error) {
      setLevel(previousLevel)
      showToast({
        tone: 'error',
        title: 'Logging settings',
        message: error instanceof Error ? error.message : 'Unable to save the log level.',
      })
    } finally {
      setSaving(false)
    }
  }

  const clearLogs = async () => {
    setClearingLogs(true)
    try {
      const response = await fetch('/api/settings/logging/output', { method: 'DELETE' })
      if (!response.ok) throw new Error('Unable to clear application logs.')
      await loadLogs()
      showToast({ tone: 'success', title: 'Application logs', message: 'Log files cleared.' })
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Application logs',
        message: error instanceof Error ? error.message : 'Unable to clear application logs.',
      })
    } finally {
      setClearingLogs(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel className="overflow-hidden">
        <div className="flex items-start gap-3 border-b border-border bg-panel px-5 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center border border-border bg-card text-accent">
            <TerminalWindowIcon className="size-4" weight="duotone" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Application logging</h2>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              Controls Pi Studio application logs. Next.js development request logs are managed by
              the framework and are not filtered by this setting.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-5 p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-medium text-foreground">Log level</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Messages below the selected severity are suppressed.
              </p>
            </div>
            <Select
              value={level}
              disabled={loading || saving}
              onValueChange={(value) => value && void changeLevel(value as LogLevel)}
            >
              <SelectTrigger className="min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  {LOG_LEVELS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="border-t border-border pt-4">
            <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              Log directory
            </p>
            <code
              className="mt-1.5 block truncate font-mono text-[11px] text-foreground"
              title={logDirectory}
            >
              {logDirectory || 'Loading…'}
            </code>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Packaged builds write server output to server.log. main.log is created when the
              desktop process fails during startup.
            </p>
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-panel px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Log output</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Latest output from server.log and main.log · {formatBytes(logs?.totalSize ?? 0)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshingLogs || clearingLogs}
              onClick={() => void loadLogs()}
            >
              <ArrowClockwiseIcon data-icon="inline-start" />
              Refresh
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={clearingLogs || (logs?.totalSize ?? 0) === 0}
              onClick={() => void clearLogs()}
            >
              <TrashIcon data-icon="inline-start" />
              Clear logs
            </Button>
          </div>
        </div>

        {logs && logs.totalSize > 0 ? (
          <div className="divide-y divide-border">
            {logs.files
              .filter((file) => file.size > 0)
              .map((file) => (
                <section key={file.name}>
                  <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-2.5">
                    <code
                      className="truncate font-mono text-[11px] font-medium text-foreground"
                      title={file.path}
                    >
                      {file.name}
                    </code>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {formatBytes(file.size)}
                      {file.truncated ? ' · latest 256 KB' : ''}
                    </span>
                  </div>
                  <ScrollArea
                    horizontal
                    className="h-72 border-t border-border bg-muted/35"
                    viewportClassName="outline-none"
                    contentClassName="min-h-full min-w-max p-4"
                  >
                    <pre className="font-mono text-[11px] leading-5 whitespace-pre text-foreground/85">
                      {file.content}
                    </pre>
                  </ScrollArea>
                </section>
              ))}
          </div>
        ) : (
          <Empty className="min-h-64 rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TerminalWindowIcon />
              </EmptyMedia>
              <EmptyTitle>No application logs</EmptyTitle>
              <EmptyDescription>
                Log files have not been created yet or were recently cleared.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </Panel>
    </div>
  )
}

function StorageDashboard({ stats }: { stats: StorageStats }) {
  const totalSize = stats.entries.reduce((total, entry) => total + entry.size, 0)
  const totalCount = stats.entries.reduce((total, entry) => total + entry.count, 0)
  const locationCount = new Set(stats.entries.flatMap((entry) => entry.paths)).size
  const sortedEntries = [...stats.entries].sort((left, right) => right.size - left.size)
  const largestEntry = sortedEntries[0]

  return (
    <div className="flex flex-col gap-4">
      <Panel className="grid overflow-hidden lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,.55fr)]">
        <section className="border-b border-border p-5 lg:border-r lg:border-b-0 lg:p-6">
          <div className="flex items-center gap-2 text-accent">
            <HardDrivesIcon className="size-4" weight="duotone" />
            <span className="font-mono text-[10px] tracking-[0.18em] uppercase">
              Local footprint
            </span>
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                Tracked storage
              </p>
              <p className="mt-1 text-4xl leading-none font-semibold tracking-tight text-foreground">
                {formatBytes(totalSize)}
              </p>
            </div>
            <p className="max-w-xs text-xs leading-5 text-muted-foreground lg:text-right">
              Combined footprint of Pi Studio data, workspace attachments, and agent resources.
            </p>
          </div>

          <div
            className="mt-5 flex h-2.5 w-full overflow-hidden bg-muted"
            role="img"
            aria-label="Storage distribution by resource"
          >
            {sortedEntries.map((entry) => (
              <div
                key={entry.id}
                className={storageToneClass(entry.id)}
                style={{ width: `${storagePercentage(entry.size, totalSize)}%` }}
                title={`${entry.label}: ${formatBytes(entry.size)}`}
              />
            ))}
          </div>
          <div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2 xl:grid-cols-6">
            {sortedEntries.map((entry) => (
              <div key={entry.id} className="flex min-w-0 items-center gap-2">
                <span className={`size-1.5 shrink-0 ${storageToneClass(entry.id)}`} />
                <span className="truncate text-[11px] text-muted-foreground">{entry.label}</span>
                <span className="ml-auto font-mono text-[10px] text-foreground">
                  {formatPercentage(entry.size, totalSize)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <aside className="grid grid-cols-2 divide-x divide-y divide-border">
          <StorageMetric label="Tracked objects" value={totalCount.toLocaleString()} />
          <StorageMetric label="Storage locations" value={locationCount.toLocaleString()} />
          <StorageMetric
            label="Largest category"
            value={largestEntry?.label ?? 'None'}
            detail={largestEntry ? formatBytes(largestEntry.size) : '0 B'}
          />
          <StorageMetric
            label="Last measured"
            value={new Date(stats.generatedAt).toLocaleDateString()}
            detail={new Date(stats.generatedAt).toLocaleTimeString()}
          />
        </aside>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="flex items-end justify-between gap-4 border-b border-border bg-panel px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Storage map</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Physical locations and relative footprint by resource type.
            </p>
          </div>
          <span className="hidden font-mono text-[9px] tracking-wider text-muted-foreground uppercase sm:inline">
            {stats.entries.length} resource types
          </span>
        </div>
        <div className="divide-y divide-border">
          {stats.entries.map((entry) => (
            <StorageResource key={entry.id} entry={entry} totalSize={totalSize} />
          ))}
        </div>
      </Panel>
    </div>
  )
}

function StorageMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="flex min-h-20 flex-col justify-between gap-2 p-4 xl:flex-row xl:items-end">
      <span className="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <div className="min-w-0 xl:text-right">
        <p className="truncate text-lg leading-none font-semibold text-foreground">{value}</p>
        {detail && <p className="mt-1 font-mono text-[10px] text-muted-foreground">{detail}</p>}
      </div>
    </div>
  )
}

function StorageResource({ entry, totalSize }: { entry: StorageEntry; totalSize: number }) {
  const percentage = storagePercentage(entry.size, totalSize)

  return (
    <section className="group/storage relative grid gap-4 px-5 py-4 transition-colors hover:bg-panel/55 md:grid-cols-[minmax(240px,.85fr)_minmax(280px,1.25fr)_180px] md:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center border border-border bg-card text-accent transition-colors group-hover/storage:border-accent/40">
          <StorageIcon id={entry.id} />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{entry.label}</h3>
          <p className="mt-0.5 font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
            {entry.count.toLocaleString()} {entry.countLabel}
          </p>
          <p className="mt-2 max-w-sm text-xs leading-4 text-muted-foreground">
            {entry.description}
          </p>
        </div>
      </div>

      <div className="min-w-0 md:border-l md:border-border md:pl-5">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
            <MapPinIcon className="size-3" />
            {entry.paths.length} {entry.paths.length === 1 ? 'location' : 'locations'}
          </span>
          {entry.paths.length > 2 && (
            <span className="font-mono text-[9px] text-muted-foreground">
              +{entry.paths.length - 2} more
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          {entry.paths.slice(0, 2).map((path) => (
            <code
              key={path}
              className="block truncate font-mono text-[10px] leading-4 text-muted-foreground/75"
              title={path}
            >
              {path}
            </code>
          ))}
        </div>
      </div>

      <div className="flex items-end justify-between gap-4 md:block md:text-right">
        <div>
          <p className="text-xl leading-none font-semibold tracking-tight text-foreground">
            {formatBytes(entry.size)}
          </p>
          <p className="mt-1 font-mono text-[9px] text-muted-foreground">
            {formatPercentage(entry.size, totalSize)} of total
          </p>
        </div>
        <Progress
          value={Math.max(percentage, 1)}
          className="mt-3 w-28 md:ml-auto"
          trackClassName="h-1.5 rounded-none bg-muted/80"
          indicatorClassName={storageToneClass(entry.id)}
          aria-label={`${entry.label} storage share`}
        />
      </div>
    </section>
  )
}

function StorageIcon({ id }: { id: StorageEntry['id'] }) {
  const iconProps = { className: 'size-4', weight: 'duotone' as const }
  if (id === 'database') return <DatabaseIcon {...iconProps} />
  if (id === 'attachments') return <PaperclipIcon {...iconProps} />
  if (id === 'logs') return <TerminalWindowIcon {...iconProps} />
  if (id === 'skills') return <PuzzlePieceIcon {...iconProps} />
  if (id === 'prompts') return <FileTextIcon {...iconProps} />
  return <ChatsCircleIcon {...iconProps} />
}

function storageToneClass(id: StorageEntry['id']) {
  if (id === 'database') return 'bg-accent'
  if (id === 'sessions') return 'bg-accent/75'
  if (id === 'skills') return 'bg-accent/55'
  if (id === 'attachments') return 'bg-accent/35'
  if (id === 'logs') return 'bg-accent/25'
  return 'bg-accent/20'
}

function storagePercentage(size: number, total: number) {
  return total > 0 ? (size / total) * 100 : 0
}

function formatPercentage(size: number, total: number) {
  const percentage = storagePercentage(size, total)
  if (percentage === 0) return '0%'
  if (percentage < 0.1) return '<0.1%'
  return `${percentage.toFixed(percentage < 10 ? 1 : 0)}%`
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
