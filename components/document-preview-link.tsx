'use client'

import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Download, Eye, FileSpreadsheet, FileText, X } from 'lucide-react'

import { Button } from '@/components/ui/button'

type DocumentKind = 'pdf' | 'word' | 'excel'

export function DocumentPreviewLink({
  href,
  label,
  kind,
}: {
  href: string
  label: string
  kind: DocumentKind
}) {
  const [open, setOpen] = useState(false)
  const Icon = kind === 'excel' ? FileSpreadsheet : FileText
  const typeLabel = kind === 'pdf' ? 'PDF' : kind === 'word' ? 'WORD' : 'EXCEL'

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <span className="my-2 flex w-full max-w-lg items-center gap-3 border border-border-strong bg-card p-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center border border-border bg-muted text-accent">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen(true)}
          aria-label={`Preview ${label}`}
        >
          <span className="block truncate font-mono text-[11px] text-foreground">{label}</span>
          <span className="mt-0.5 block font-mono text-[9px] tracking-wider text-muted-foreground">
            {typeLabel} DOCUMENT
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Preview ${label}`}
          title="Preview"
          onClick={() => setOpen(true)}
        >
          <Eye />
        </Button>
        <Button
          render={<a href={href} download={label} aria-label={`Download ${label}`} />}
          variant="ghost"
          size="icon-sm"
          title="Download"
        >
          <Download />
        </Button>
      </span>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-background/80 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Viewport className="fixed inset-0 flex items-center justify-center p-4 sm:p-8">
          <Dialog.Popup className="flex h-[min(86dvh,60rem)] w-[min(94vw,72rem)] flex-col overflow-hidden border border-border-strong bg-card shadow-2xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <header className="flex min-w-0 items-center gap-3 border-b border-border px-3 py-2.5">
              <Icon className="size-4 shrink-0 text-accent" aria-hidden="true" />
              <Dialog.Title className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {label}
              </Dialog.Title>
              <Button
                render={<a href={href} download={label} aria-label={`Download ${label}`} />}
                variant="ghost"
                size="icon-sm"
                title="Download"
              >
                <Download />
              </Button>
              <Dialog.Close
                render={
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Close preview" />
                }
              >
                <X />
              </Dialog.Close>
            </header>
            {kind === 'pdf' ? (
              <iframe
                className="min-h-0 flex-1 bg-muted"
                src={href}
                title={`Preview of ${label}`}
              />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                <span className="flex size-14 items-center justify-center border border-border-strong bg-muted text-accent">
                  <Icon className="size-7" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Preview is not available for this format yet.
                  </p>
                  <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                    Download the {typeLabel.toLowerCase()} document and open it with your preferred
                    desktop application.
                  </p>
                </div>
                <Button render={<a href={href} download={label} />} variant="outline">
                  <Download />
                  Download file
                </Button>
              </div>
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
