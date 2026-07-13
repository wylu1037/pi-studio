'use client'

import { useEffect, useId, useState } from 'react'

let mermaidReady = false

export function MermaidDiagram({ chart }: { chart: string }) {
  const reactId = useId()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function renderDiagram() {
      try {
        setError(null)
        setSvg(null)
        const mermaid = (await import('mermaid')).default
        if (!mermaidReady) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'base',
            themeVariables: {
              background: 'transparent',
              primaryColor: '#f7f5ef',
              primaryTextColor: '#30313d',
              primaryBorderColor: '#c9c2b6',
              lineColor: '#5b65a4',
              secondaryColor: '#eef0f8',
              tertiaryColor: '#fbfaf6',
              fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace',
            },
          })
          mermaidReady = true
        }

        const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`
        const result = await mermaid.render(id, chart)
        if (!cancelled) setSvg(result.svg)
      } catch (renderError) {
        if (!cancelled) {
          setError(
            renderError instanceof Error
              ? renderError.message
              : 'Unable to render Mermaid diagram.',
          )
        }
      }
    }

    void renderDiagram()
    return () => {
      cancelled = true
    }
  }, [chart, reactId])

  if (error) {
    return (
      <div className="overflow-hidden border border-warning/50 bg-warning/8">
        <div className="border-b border-warning/30 px-3 py-1 font-mono text-[10px] text-warning uppercase">
          Mermaid render failed
        </div>
        <pre className="max-w-full overflow-hidden p-3 font-mono text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground/90">
          <code>{chart}</code>
        </pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="flex min-h-32 items-center justify-center border border-border bg-panel/60 font-mono text-[11px] text-muted-foreground">
        Rendering diagram...
      </div>
    )
  }

  return (
    <div
      className="max-w-full overflow-hidden border border-border bg-card p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
