'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ArrowClockwiseIcon,
  ChartLineIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  FloppyDiskIcon,
  LockKeyIcon,
  PulseIcon,
  SlidersHorizontalIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import {
  keepPreviousData,
  useIsFetching,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { Panel } from '@/components/pi-ui'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  METRICS_DETAIL_LEVELS,
  METRICS_INTERVAL_SECONDS,
  METRICS_RETENTION_DAYS,
  METRIC_RANGES,
  metricIntervalSeconds,
  type MetricDefinition,
  type MetricGroup,
  type MetricId,
  type MetricRange,
  type MetricsDetailLevel,
  type MetricsIntervalSeconds,
  type MetricsRetentionDays,
} from '@/lib/metrics/catalog'
import { applyMetricsPreset, markMetricsSettingsCustom } from '@/lib/metrics/settings'
import type {
  MetricSeries,
  MetricsHealth,
  MetricsSettings as MetricsSettingsValue,
  MetricsSettingsResponse,
  MetricsSummary,
} from '@/lib/metrics/types'
import { showToast } from '@/lib/toast'

type MetricsView = 'overview' | 'collection'

const DETAIL_LEVEL_COPY: Record<MetricsDetailLevel, { label: string; description: string }> = {
  essential: {
    label: 'Essential',
    description: 'Core health, active runs, usage, scheduler, and storage at a low sampling rate.',
  },
  standard: {
    label: 'Standard',
    description: 'Balanced local monitoring for everyday use, including API and runtime details.',
  },
  diagnostic: {
    label: 'Diagnostic',
    description:
      'All metrics every five seconds for one hour, then automatically returns to Standard.',
  },
  custom: {
    label: 'Custom',
    description: 'A tailored mix of metrics and sampling intervals.',
  },
}

const GROUP_LABELS: Record<MetricGroup, string> = {
  resources: 'Runtime resources',
  api: 'Local API',
  runs: 'Agent runs',
  usage: 'Model usage',
  scheduler: 'Scheduler',
  storage: 'Storage',
}

const GROUP_ORDER: MetricGroup[] = ['resources', 'api', 'runs', 'usage', 'scheduler', 'storage']

export function MetricsSettings() {
  const queryClient = useQueryClient()
  const [view, setView] = useState<MetricsView>('overview')
  const [range, setRange] = useState<MetricRange>('24h')
  const [draft, setDraft] = useState<MetricsSettingsValue | null>(null)
  const metricsFetchCount =
    useIsFetching({ queryKey: ['metrics-summary'] }) +
    useIsFetching({ queryKey: ['metrics-series'] })
  const settingsQuery = useQuery({
    queryKey: ['metrics-settings'],
    queryFn: () => requestJson<MetricsSettingsResponse>('/api/settings/metrics'),
  })

  useEffect(() => {
    if (settingsQuery.data) setDraft(cloneSettings(settingsQuery.data.settings))
  }, [settingsQuery.data])

  const saveMutation = useMutation({
    mutationFn: (settings: MetricsSettingsValue) =>
      requestJson<MetricsSettingsResponse>('/api/settings/metrics', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      }),
    onSuccess: (response) => {
      queryClient.setQueryData(['metrics-settings'], response)
      setDraft(cloneSettings(response.settings))
      void queryClient.invalidateQueries({ queryKey: ['metrics-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['metrics-series'] })
      showToast({
        tone: 'success',
        title: 'Metrics settings',
        message: response.settings.enabled
          ? 'Collection settings saved.'
          : 'Metrics collection disabled.',
      })
    },
    onError: (error) => {
      showToast({
        tone: 'error',
        title: 'Metrics settings',
        message: error instanceof Error ? error.message : 'Unable to save metrics settings.',
      })
    },
  })

  const persistSettings = async (settings: MetricsSettingsValue) => {
    try {
      await saveMutation.mutateAsync(settings)
    } catch {
      // The mutation reports the actionable error through the shared toast host.
    }
  }

  const refreshMetrics = async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['metrics-summary', range], type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['metrics-series'], type: 'active' }),
    ])
  }

  const savedSettings = settingsQuery.data?.settings
  const isDirty = Boolean(
    draft && savedSettings && settingsFingerprint(draft) !== settingsFingerprint(savedSettings),
  )

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup
          value={[view]}
          onValueChange={(values) => {
            const next = values[0]
            if (next === 'overview' || next === 'collection') setView(next)
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Metrics section"
        >
          <ToggleGroupItem value="overview" className="rounded-none px-3 font-mono text-xs">
            <ChartLineIcon data-icon="inline-start" />
            Overview
          </ToggleGroupItem>
          <ToggleGroupItem value="collection" className="rounded-none px-3 font-mono text-xs">
            <SlidersHorizontalIcon data-icon="inline-start" />
            Collection
          </ToggleGroupItem>
        </ToggleGroup>

        {view === 'overview' && (
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <ToggleGroup
              value={[range]}
              onValueChange={(values) => {
                const next = values[0]
                if (METRIC_RANGES.includes(next as MetricRange)) setRange(next as MetricRange)
              }}
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="Metrics time range"
            >
              {METRIC_RANGES.map((item) => (
                <ToggleGroupItem
                  key={item}
                  value={item}
                  className="rounded-none px-2 font-mono text-[10px] uppercase"
                >
                  {item}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Refresh metrics"
              title="Refresh metrics"
              disabled={!settingsQuery.data || metricsFetchCount > 0}
              onClick={() => void refreshMetrics()}
            >
              <ArrowClockwiseIcon className={metricsFetchCount > 0 ? 'animate-spin' : undefined} />
            </Button>
          </div>
        )}

        {view === 'collection' && (
          <div className="flex items-center gap-2 self-end sm:self-auto">
            {isDirty && (
              <Badge variant="outline" className="rounded-none border-warning/40 text-warning">
                Unsaved
              </Badge>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!isDirty || saveMutation.isPending || !settingsQuery.data}
              onClick={() => {
                if (settingsQuery.data) {
                  setDraft(cloneSettings(settingsQuery.data.settings))
                }
              }}
            >
              Reset
            </Button>
            <Button
              type="submit"
              form="metrics-collection-form"
              size="sm"
              disabled={!isDirty || saveMutation.isPending || !draft}
            >
              <FloppyDiskIcon data-icon="inline-start" />
              {saveMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        )}
      </div>

      {settingsQuery.isPending ? (
        <MetricsLoading />
      ) : settingsQuery.isError || !settingsQuery.data || !draft ? (
        <Alert variant="destructive" className="rounded-none">
          <WarningCircleIcon />
          <AlertTitle>Metrics settings could not be loaded</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{errorText(settingsQuery.error, 'Unable to load metrics settings.')}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => settingsQuery.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : view === 'overview' ? (
        <MetricsOverview
          settings={settingsQuery.data.settings}
          catalog={settingsQuery.data.catalog}
          range={range}
          saving={saveMutation.isPending}
          onSave={persistSettings}
        />
      ) : (
        <MetricsCollection
          draft={draft}
          catalog={settingsQuery.data.catalog}
          dirty={isDirty}
          saving={saveMutation.isPending}
          onChange={setDraft}
          onSave={persistSettings}
        />
      )}
    </div>
  )
}

function MetricsOverview({
  settings,
  catalog,
  range,
  saving,
  onSave,
}: {
  settings: MetricsSettingsValue
  catalog: MetricDefinition[]
  range: MetricRange
  saving: boolean
  onSave: (settings: MetricsSettingsValue) => Promise<void>
}) {
  const enabledSeries = useMemo(
    () =>
      catalog.filter(
        (metric) => metric.supportsSeries && settings.enabledMetricIds.includes(metric.id),
      ),
    [catalog, settings.enabledMetricIds],
  )
  const [selectedMetricId, setSelectedMetricId] = useState<MetricId>('runtime.rss')

  useEffect(() => {
    if (!enabledSeries.some((metric) => metric.id === selectedMetricId) && enabledSeries[0]) {
      setSelectedMetricId(enabledSeries[0].id)
    }
  }, [enabledSeries, selectedMetricId])

  const selectedMetric =
    catalog.find((metric) => metric.id === selectedMetricId) ?? enabledSeries[0]
  const summaryQuery = useQuery({
    queryKey: ['metrics-summary', range],
    queryFn: () => requestJson<MetricsSummary>(`/api/metrics/summary?range=${range}`),
    placeholderData: keepPreviousData,
    refetchInterval: settings.enabled ? 15_000 : false,
    refetchIntervalInBackground: false,
  })
  const seriesQuery = useQuery({
    queryKey: ['metrics-series', selectedMetric?.id, range],
    queryFn: () =>
      requestJson<MetricSeries>(
        `/api/metrics/series?metricId=${encodeURIComponent(selectedMetric!.id)}&range=${range}`,
      ),
    enabled: settings.enabled && Boolean(selectedMetric),
    placeholderData: keepPreviousData,
    refetchInterval: settings.enabled ? 15_000 : false,
    refetchIntervalInBackground: false,
  })

  if (summaryQuery.isPending) return <OverviewLoading />

  if (summaryQuery.isError && !summaryQuery.data) {
    return (
      <Alert variant="destructive" className="rounded-none">
        <WarningCircleIcon />
        <AlertTitle>Metrics overview could not be loaded</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{errorText(summaryQuery.error, 'Unable to load the metrics overview.')}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => summaryQuery.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const summary = summaryQuery.data
  if (!summary) return null
  const isEnabled = (metricId: MetricId) => settings.enabledMetricIds.includes(metricId)
  const activeRunsEnabled = isEnabled('runs.active')
  const apiDetails = [
    isEnabled('api.requestRate') ? `${formatInteger(summary.api.requests)} requests` : null,
    isEnabled('api.errorRate')
      ? `${formatOptionalMetric(summary.api.errorRate, 'percent')} errors`
      : null,
  ].filter((detail): detail is string => Boolean(detail))
  const resourceDetails = [
    isEnabled('runtime.cpu')
      ? `${formatOptionalMetric(summary.runtime.cpuPercent, 'percent')} CPU`
      : null,
    isEnabled('runtime.uptime') ? `${formatDuration(summary.runtime.uptimeSeconds)} uptime` : null,
  ].filter((detail): detail is string => Boolean(detail))

  return (
    <div className="flex flex-col gap-4">
      {summaryQuery.isRefetchError && (
        <Alert className="rounded-none border-warning/40 bg-warning/5">
          <WarningCircleIcon className="text-warning" />
          <AlertTitle>Showing the last available snapshot</AlertTitle>
          <AlertDescription>
            Refresh failed, so Pi Studio kept the previously loaded values instead of replacing
            them.
          </AlertDescription>
        </Alert>
      )}

      {!settings.enabled || summary.health === 'disabled' ? (
        <Panel>
          <Empty className="min-h-[420px] rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PulseIcon />
              </EmptyMedia>
              <EmptyTitle>Metrics collection is off</EmptyTitle>
              <EmptyDescription>
                Historical samples remain local and available until their retention window expires.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                disabled={saving}
                onClick={() => void onSave({ ...settings, enabled: true })}
              >
                Enable metrics
              </Button>
            </EmptyContent>
          </Empty>
        </Panel>
      ) : (
        <>
          {summary.health === 'warming' && (
            <Alert className="rounded-none border-accent/35 bg-accent/5">
              <ClockCountdownIcon className="text-accent" />
              <AlertTitle>Metrics are warming up</AlertTitle>
              <AlertDescription>
                Collection has started. The first runtime samples should appear after one sampling
                interval.
              </AlertDescription>
            </Alert>
          )}

          <Panel className="grid gap-px overflow-hidden bg-border sm:grid-cols-2 xl:grid-cols-4">
            <OverviewMetric
              label="App health"
              value={healthLabel(summary.health)}
              detail={
                summary.warnings.length === 0
                  ? 'No active warnings'
                  : `${summary.warnings.length} active warning${summary.warnings.length === 1 ? '' : 's'}`
              }
            />
            <OverviewMetric
              label="Active runs"
              value={
                activeRunsEnabled ? formatInteger(summary.runs.active + summary.runs.queued) : '—'
              }
              detail={
                activeRunsEnabled
                  ? `${summary.runs.active} running · ${summary.runs.queued} queued`
                  : 'Monitoring disabled'
              }
            />
            <OverviewMetric
              label="API P95"
              value={
                isEnabled('api.latency')
                  ? formatOptionalMetric(summary.api.p95LatencyMs, 'milliseconds')
                  : '—'
              }
              detail={apiDetails.length > 0 ? apiDetails.join(' · ') : 'Monitoring disabled'}
            />
            <OverviewMetric
              label="Resident memory"
              value={
                isEnabled('runtime.rss')
                  ? formatOptionalMetric(summary.runtime.rssBytes, 'bytes')
                  : '—'
              }
              detail={
                resourceDetails.length > 0 ? resourceDetails.join(' · ') : 'Monitoring disabled'
              }
            />
          </Panel>

          <Panel className="overflow-hidden">
            <div className="flex flex-col justify-between gap-3 border-b border-border bg-panel px-5 py-3.5 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Trend</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  One signal at a time so different units never share a misleading scale.
                </p>
              </div>
              {enabledSeries.length > 0 && selectedMetric && (
                <Select
                  value={selectedMetric.id}
                  onValueChange={(value) => value && setSelectedMetricId(value as MetricId)}
                >
                  <SelectTrigger className="min-w-48">
                    <SelectValue>{selectedMetric.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectGroup>
                      {enabledSeries.map((metric) => (
                        <SelectItem key={metric.id} value={metric.id}>
                          {metric.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            </div>
            <TrendChart
              metric={selectedMetric}
              range={range}
              series={seriesQuery.data}
              loading={seriesQuery.isPending || seriesQuery.isFetching}
              error={seriesQuery.isError && !seriesQuery.data}
            />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
            <Panel className="overflow-hidden">
              <div className="border-b border-border bg-panel px-5 py-3.5">
                <h3 className="text-sm font-semibold text-foreground">Workload & usage</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Agent outcomes and model consumption for the selected range.
                </p>
              </div>
              <div className="grid md:grid-cols-2 md:divide-x md:divide-border">
                <BreakdownSection
                  eyebrow="Runs"
                  primary={
                    isEnabled('runs.successRate')
                      ? formatOptionalMetric(summary.runs.successRate, 'percent')
                      : '—'
                  }
                  primaryLabel="success rate"
                  rows={[
                    [
                      'Completed',
                      isEnabled('runs.successRate') ? formatInteger(summary.runs.completed) : '—',
                    ],
                    [
                      'Failed / aborted',
                      isEnabled('runs.successRate')
                        ? formatInteger(summary.runs.failed + summary.runs.aborted)
                        : '—',
                    ],
                    [
                      'P95 duration',
                      isEnabled('runs.duration')
                        ? formatOptionalMetric(summary.runs.p95DurationMs, 'milliseconds')
                        : '—',
                    ],
                    [
                      'P95 first response',
                      isEnabled('runs.ttft')
                        ? formatOptionalMetric(
                            summary.runs.p95TimeToFirstResponseMs,
                            'milliseconds',
                          )
                        : '—',
                    ],
                  ]}
                />
                <BreakdownSection
                  eyebrow="Usage"
                  primary={
                    isEnabled('usage.tokens')
                      ? formatMetricValue(summary.usage.totalTokens, 'tokens')
                      : '—'
                  }
                  primaryLabel="total tokens"
                  rows={[
                    [
                      'Input',
                      isEnabled('usage.tokens')
                        ? formatMetricValue(summary.usage.inputTokens, 'tokens')
                        : '—',
                    ],
                    [
                      'Output',
                      isEnabled('usage.tokens')
                        ? formatMetricValue(summary.usage.outputTokens, 'tokens')
                        : '—',
                    ],
                    [
                      'Cache hit',
                      isEnabled('usage.cacheHitRate')
                        ? formatOptionalMetric(summary.usage.cacheHitRate, 'percent')
                        : '—',
                    ],
                    [
                      'Reported cost',
                      isEnabled('usage.cost')
                        ? formatMetricValue(summary.usage.cost, 'currency')
                        : '—',
                    ],
                  ]}
                />
              </div>
            </Panel>

            <Panel className="overflow-hidden">
              <div className="border-b border-border bg-panel px-5 py-3.5">
                <h3 className="text-sm font-semibold text-foreground">Recent warnings</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Threshold-based signals from the current snapshot.
                </p>
              </div>
              {summary.warnings.length > 0 ? (
                <div className="divide-y divide-border">
                  {summary.warnings.map((warning) => (
                    <div key={warning.id} className="flex gap-3 px-4 py-3.5">
                      <WarningCircleIcon
                        className={
                          warning.severity === 'critical'
                            ? 'mt-0.5 size-4 shrink-0 text-destructive'
                            : 'mt-0.5 size-4 shrink-0 text-warning'
                        }
                        weight="fill"
                      />
                      <div>
                        <p className="text-xs font-semibold text-foreground">{warning.title}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {warning.detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-52 flex-col items-center justify-center px-6 py-8 text-center">
                  <CheckCircleIcon className="size-6 text-success" weight="duotone" />
                  <p className="mt-3 text-sm font-medium text-foreground">All clear</p>
                  <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                    No health thresholds are currently exceeded.
                  </p>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

function MetricsCollection({
  draft,
  catalog,
  dirty,
  saving,
  onChange,
  onSave,
}: {
  draft: MetricsSettingsValue
  catalog: MetricDefinition[]
  dirty: boolean
  saving: boolean
  onChange: (settings: MetricsSettingsValue) => void
  onSave: (settings: MetricsSettingsValue) => Promise<void>
}) {
  const selectedMetricIds = new Set(draft.enabledMetricIds)

  const updateMetricEnabled = (metricId: MetricId, enabled: boolean) => {
    const nextIds = new Set(draft.enabledMetricIds)
    if (enabled) nextIds.add(metricId)
    else nextIds.delete(metricId)
    const custom = markMetricsSettingsCustom(draft)
    onChange({
      ...custom,
      enabledMetricIds: catalog
        .filter((metric) => nextIds.has(metric.id))
        .map((metric) => metric.id),
    })
  }

  const updateMetricInterval = (metricId: MetricId, value: string) => {
    const custom = markMetricsSettingsCustom(draft)
    const intervalOverrides = { ...custom.intervalOverrides }
    if (value === 'default') delete intervalOverrides[metricId]
    else intervalOverrides[metricId] = Number(value) as MetricsIntervalSeconds
    onChange({ ...custom, intervalOverrides })
  }

  return (
    <form
      id="metrics-collection-form"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (dirty && !saving) void onSave(draft)
      }}
    >
      <Panel className="overflow-hidden">
        <div className="border-b border-border bg-panel px-5 py-3.5">
          <h3 className="text-sm font-semibold text-foreground">Policy</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Set the global collection level, sampling cadence, and local retention window.
          </p>
        </div>
        <FieldGroup className="p-5">
          <Field orientation="responsive" className="justify-between border-b border-border pb-5">
            <FieldContent>
              <FieldTitle>Collect application metrics</FieldTitle>
              <FieldDescription className="max-w-2xl text-xs leading-5">
                Samples stay in the local Pi Studio database and are never sent to a telemetry
                service.
              </FieldDescription>
            </FieldContent>
            <div className="flex shrink-0 justify-end">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
                aria-label="Collect application metrics"
              />
            </div>
          </Field>

          <Field>
            <FieldContent>
              <FieldTitle>Detail level</FieldTitle>
              <FieldDescription className="text-xs leading-5">
                {DETAIL_LEVEL_COPY[draft.detailLevel].description}
              </FieldDescription>
            </FieldContent>
            <ToggleGroup
              value={[draft.detailLevel]}
              onValueChange={(values) => {
                const level = values[0] as MetricsDetailLevel | undefined
                if (level && METRICS_DETAIL_LEVELS.includes(level)) {
                  onChange(applyMetricsPreset(draft, level))
                }
              }}
              variant="outline"
              spacing={0}
              aria-label="Metrics detail level"
              className="grid w-full grid-cols-2 sm:w-fit sm:grid-cols-4"
            >
              {METRICS_DETAIL_LEVELS.map((level) => (
                <ToggleGroupItem
                  key={level}
                  value={level}
                  className="rounded-none px-4 font-mono text-xs"
                >
                  {DETAIL_LEVEL_COPY[level].label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          {draft.detailLevel === 'diagnostic' && draft.diagnosticUntil && (
            <Alert className="rounded-none border-warning/40 bg-warning/5">
              <ClockCountdownIcon className="text-warning" />
              <AlertTitle>Diagnostic collection is temporary</AlertTitle>
              <AlertDescription>
                It will return to Standard after {formatAbsoluteTime(draft.diagnosticUntil)} to
                avoid retaining high-frequency samples indefinitely.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-5 border-t border-border pt-5 md:grid-cols-2">
            <Field>
              <FieldContent>
                <FieldTitle>Default sampling interval</FieldTitle>
                <FieldDescription className="text-xs leading-5">
                  Applies to gauges unless a metric has a slower minimum or a custom override.
                </FieldDescription>
              </FieldContent>
              <Select
                value={String(draft.intervalSeconds)}
                onValueChange={(value) => {
                  if (!value) return
                  const custom = markMetricsSettingsCustom(draft)
                  onChange({
                    ...custom,
                    intervalSeconds: Number(value) as MetricsIntervalSeconds,
                  })
                }}
              >
                <SelectTrigger className="min-w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {METRICS_INTERVAL_SECONDS.map((seconds) => (
                      <SelectItem key={seconds} value={String(seconds)}>
                        Every {formatInterval(seconds)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldContent>
                <FieldTitle>Retention</FieldTitle>
                <FieldDescription className="text-xs leading-5">
                  Older metric samples are removed automatically. Run and usage records keep their
                  own lifecycle.
                </FieldDescription>
              </FieldContent>
              <Select
                value={String(draft.retentionDays)}
                onValueChange={(value) =>
                  value &&
                  onChange({ ...draft, retentionDays: Number(value) as MetricsRetentionDays })
                }
              >
                <SelectTrigger className="min-w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {METRICS_RETENTION_DAYS.map((days) => (
                      <SelectItem key={days} value={String(days)}>
                        {days} {days === 1 ? 'day' : 'days'}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </FieldGroup>
      </Panel>

      <Alert className="rounded-none">
        <LockKeyIcon />
        <AlertTitle>Numeric signals only</AlertTitle>
        <AlertDescription>
          Metrics never store prompt or message text, file paths, API keys, raw errors, or request
          bodies.
        </AlertDescription>
      </Alert>

      <Panel className="overflow-hidden">
        <div className="flex flex-col justify-between gap-2 border-b border-border bg-panel px-5 py-3.5 sm:flex-row sm:items-end">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Metric catalog</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Event and derived metrics follow app activity; gauges and snapshots use sampling
              intervals.
            </p>
          </div>
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            {selectedMetricIds.size} of {catalog.length} enabled
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/25 font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
                <th className="px-5 py-2.5 font-medium">Metric</th>
                <th className="w-24 px-4 py-2.5 text-center font-medium">Monitor</th>
                <th className="w-28 px-4 py-2.5 font-medium">Kind</th>
                <th className="w-48 px-5 py-2.5 font-medium">Interval</th>
              </tr>
            </thead>
            <tbody>
              {GROUP_ORDER.map((group) => {
                const metrics = catalog.filter((metric) => metric.group === group)
                if (metrics.length === 0) return null
                return (
                  <Fragment key={group}>
                    <tr className="border-b border-border bg-panel/70">
                      <th
                        colSpan={4}
                        className="px-5 py-2 font-mono text-[9px] font-medium tracking-[0.16em] text-muted-foreground uppercase"
                      >
                        {GROUP_LABELS[group]}
                      </th>
                    </tr>
                    {metrics.map((metric) => {
                      const enabled = selectedMetricIds.has(metric.id)
                      const isSampled = metric.kind === 'gauge' || metric.kind === 'snapshot'
                      const minimum = metric.minimumIntervalSeconds ?? 5
                      const effectiveDefault = metricIntervalSeconds(metric.id, {
                        intervalSeconds: draft.intervalSeconds,
                        intervalOverrides: {},
                      })
                      return (
                        <tr
                          key={metric.id}
                          className="border-b border-border last:border-b-0 hover:bg-panel/45"
                        >
                          <td className="px-5 py-3.5">
                            <p className="text-xs font-semibold text-foreground">{metric.label}</p>
                            <p className="mt-1 max-w-2xl text-xs leading-4 text-muted-foreground">
                              {metric.description}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <Switch
                              checked={enabled}
                              onCheckedChange={(checked) => updateMetricEnabled(metric.id, checked)}
                              aria-label={`${enabled ? 'Disable' : 'Enable'} ${metric.label}`}
                            />
                          </td>
                          <td className="px-4 py-3.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                            {metric.kind}
                          </td>
                          <td className="px-5 py-3.5">
                            {isSampled ? (
                              <Select
                                value={
                                  draft.intervalOverrides[metric.id]
                                    ? String(draft.intervalOverrides[metric.id])
                                    : 'default'
                                }
                                onValueChange={(value) =>
                                  value && updateMetricInterval(metric.id, value)
                                }
                              >
                                <SelectTrigger size="sm" className="min-w-40">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="start">
                                  <SelectGroup>
                                    <SelectItem value="default">
                                      Default ({formatInterval(effectiveDefault)})
                                    </SelectItem>
                                    {METRICS_INTERVAL_SECONDS.filter(
                                      (seconds) => seconds >= minimum,
                                    ).map((seconds) => (
                                      <SelectItem key={seconds} value={String(seconds)}>
                                        Every {formatInterval(seconds)}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {metric.kind === 'event' ? 'On event' : 'From app data'}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </form>
  )
}

function TrendChart({
  metric,
  range,
  series,
  loading,
  error,
}: {
  metric?: MetricDefinition
  range: MetricRange
  series?: MetricSeries
  loading: boolean
  error: boolean
}) {
  if (!metric) {
    return (
      <Empty className="min-h-72 rounded-none border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ChartLineIcon />
          </EmptyMedia>
          <EmptyTitle>No trend metrics enabled</EmptyTitle>
          <EmptyDescription>
            Enable a series-capable metric in Collection to chart it here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const matchingSeries =
    series?.metricId === metric.id && series.range === range ? series : undefined

  if (loading && !matchingSeries) {
    return <Skeleton className="m-5 h-72 rounded-none" />
  }

  if (error) {
    return (
      <Empty className="min-h-72 rounded-none border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningCircleIcon />
          </EmptyMedia>
          <EmptyTitle>Trend unavailable</EmptyTitle>
          <EmptyDescription>The current series could not be loaded.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (!matchingSeries || matchingSeries.points.length === 0) {
    return (
      <Empty className="min-h-72 rounded-none border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClockCountdownIcon />
          </EmptyMedia>
          <EmptyTitle>No samples in this range</EmptyTitle>
          <EmptyDescription>
            {metric.kind === 'event' || metric.kind === 'derived'
              ? 'This signal appears after relevant app activity occurs.'
              : 'Wait for the next sampling interval or select a longer range.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const config = {
    value: { label: metric.label, color: 'var(--accent)' },
  } satisfies ChartConfig

  return (
    <div className="px-3 py-5 sm:px-5">
      <ChartContainer config={config} className="aspect-auto h-72 w-full">
        <LineChart data={matchingSeries.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            tickMargin={10}
            tickFormatter={(value) => formatChartTimestamp(String(value), range)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={58}
            tickFormatter={(value) => formatMetricValue(Number(value), metric.unit, true)}
          />
          <ChartTooltip
            cursor={{ stroke: 'var(--border)' }}
            content={
              <ChartTooltipContent
                labelFormatter={(value) => formatAbsoluteTime(String(value))}
                formatter={(value) => (
                  <div className="flex min-w-40 items-center justify-between gap-4">
                    <span className="text-muted-foreground">{metric.label}</span>
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {formatMetricValue(Number(value), metric.unit)}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--color-value)"
            strokeWidth={1.75}
            dot={false}
            activeDot={{ r: 3, fill: 'var(--color-value)' }}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  )
}

function OverviewMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="min-w-0 bg-card px-5 py-4">
      <p className="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 truncate text-2xl leading-none font-semibold tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  )
}

function BreakdownSection({
  eyebrow,
  primary,
  primaryLabel,
  rows,
}: {
  eyebrow: string
  primary: string
  primaryLabel: string
  rows: Array<[string, string]>
}) {
  return (
    <section className="p-5">
      <p className="font-mono text-[9px] tracking-[0.16em] text-muted-foreground uppercase">
        {eyebrow}
      </p>
      <div className="mt-3 flex items-end gap-2">
        <p className="text-2xl leading-none font-semibold tracking-tight text-foreground">
          {primary}
        </p>
        <p className="pb-0.5 text-xs text-muted-foreground">{primaryLabel}</p>
      </div>
      <dl className="mt-5 divide-y divide-border border-t border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-mono text-[11px] font-medium text-foreground tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function MetricsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-14 rounded-none" />
      <Skeleton className="h-28 rounded-none" />
      <Skeleton className="h-80 rounded-none" />
    </div>
  )
}

function OverviewLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-14 rounded-none" />
      <Skeleton className="h-28 rounded-none" />
      <Skeleton className="h-96 rounded-none" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-none" />
        <Skeleton className="h-72 rounded-none" />
      </div>
    </div>
  )
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...init })
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null
  if (!response.ok) {
    throw new Error(
      body && typeof body === 'object' && 'error' in body && body.error
        ? body.error
        : `Request failed with status ${response.status}.`,
    )
  }
  return body as T
}

function cloneSettings(settings: MetricsSettingsValue): MetricsSettingsValue {
  return {
    ...settings,
    enabledMetricIds: [...settings.enabledMetricIds],
    intervalOverrides: { ...settings.intervalOverrides },
  }
}

function settingsFingerprint(settings: MetricsSettingsValue) {
  return JSON.stringify({
    ...settings,
    enabledMetricIds: [...settings.enabledMetricIds].sort(),
    intervalOverrides: Object.fromEntries(Object.entries(settings.intervalOverrides).sort()),
  })
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function healthLabel(health: MetricsHealth) {
  switch (health) {
    case 'healthy':
      return 'Healthy'
    case 'degraded':
      return 'Degraded'
    case 'critical':
      return 'Critical'
    case 'disabled':
      return 'Disabled'
    case 'warming':
      return 'Warming up'
  }
}

function formatInteger(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function formatMetricValue(value: number, unit: MetricDefinition['unit'], compact = false): string {
  if (!Number.isFinite(value)) return '—'
  switch (unit) {
    case 'percent':
      return `${value.toFixed(value >= 100 ? 0 : 1)}%`
    case 'bytes':
      return formatBytes(value, compact)
    case 'milliseconds':
      return value >= 1000
        ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s`
        : `${value.toFixed(0)} ms`
    case 'seconds':
      return formatDuration(value)
    case 'count':
      return compact ? formatCompactNumber(value) : formatInteger(value)
    case 'tokens':
      return compact ? formatCompactNumber(value) : `${formatCompactNumber(value)} tok`
    case 'currency':
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: value < 0.01 ? 4 : 2,
        maximumFractionDigits: value < 0.01 ? 4 : 2,
      }).format(value)
  }
}

function formatOptionalMetric(value: number | null, unit: MetricDefinition['unit']) {
  return value === null ? '—' : formatMetricValue(value, unit)
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: Math.abs(value) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatBytes(value: number, compact = false) {
  if (value < 1024) return `${value.toFixed(0)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value / 1024
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }
  return `${amount.toFixed(compact || amount >= 100 ? 0 : amount >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function formatDuration(totalSeconds: number) {
  if (totalSeconds < 60) return `${Math.max(0, Math.floor(totalSeconds))}s`
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m`
  if (totalSeconds < 86_400) {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3600)
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`
}

function formatInterval(seconds: number) {
  return seconds >= 60 ? `${seconds / 60} min` : `${seconds} sec`
}

function formatAbsoluteTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatChartTimestamp(value: string, range: MetricRange) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: range === '7d' || range === '30d' ? 'short' : undefined,
    day: range === '7d' || range === '30d' ? 'numeric' : undefined,
    hour: range === '1h' || range === '24h' ? '2-digit' : undefined,
    minute: range === '1h' || range === '24h' ? '2-digit' : undefined,
  }).format(date)
}
