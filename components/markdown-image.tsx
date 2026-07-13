'use client'

import { useState } from 'react'
import { ExternalLink, ImageIcon, ImageOff } from 'lucide-react'

export function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <span className="my-2 block w-full max-w-xl overflow-hidden border border-border-strong bg-card">
      <span className="flex h-9 items-center gap-2 border-b border-border bg-panel/70 px-3">
        <ImageIcon className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{alt}</span>
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </span>
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="group relative block aspect-[16/10] overflow-hidden bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.995]"
        title={`Open ${alt}`}
      >
        {!loaded && !failed && (
          <span className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />
        )}
        {failed ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageOff className="size-5" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase">Preview unavailable</span>
          </span>
        ) : (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`size-full object-contain transition-[opacity,transform] duration-300 group-hover:scale-[1.01] ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
      </a>
    </span>
  )
}
