'use client'

import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Download, ImageOff, Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useSidebarOffset } from '@/hooks/use-sidebar-offset'
import { cn } from '@/lib/utils'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25

export function MarkdownImage({
  src,
  alt,
  location = alt,
}: {
  src: string
  alt: string
  location?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewZoom, setPreviewZoom] = useState(1)
  const sidebarOffset = useSidebarOffset(previewOpen)

  const zoomOut = () => setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))
  const zoomIn = () => setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))
  const previewZoomOut = () => setPreviewZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))
  const previewZoomIn = () => setPreviewZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))

  const handlePreviewOpenChange = (open: boolean) => {
    setPreviewOpen(open)
    if (!open) setPreviewZoom(1)
  }

  return (
    <Dialog.Root open={previewOpen} onOpenChange={handlePreviewOpenChange}>
      <figure className="group/image my-2 block w-fit max-w-full">
        <span className="relative block max-w-full overflow-hidden rounded-panel border border-border-strong bg-muted/60">
          {failed ? (
            <span className="flex min-h-24 min-w-48 flex-col items-center justify-center gap-2 p-6 text-muted-foreground">
              <ImageOff aria-hidden="true" />
              <span className="font-mono text-[10px] uppercase">Preview unavailable</span>
            </span>
          ) : (
            <Dialog.Trigger
              render={
                <button
                  type="button"
                  className="block max-w-full cursor-zoom-in overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  aria-label={`Preview ${alt}`}
                  title={`Preview ${alt}`}
                />
              }
            >
              <img
                src={src}
                alt={alt}
                loading="lazy"
                decoding="async"
                onLoad={() => setLoaded(true)}
                onError={() => setFailed(true)}
                className={cn(
                  'block h-auto max-w-full origin-center object-contain transition-[opacity,transform] duration-200',
                  loaded ? 'opacity-100' : 'opacity-0',
                )}
                style={{ transform: `scale(${zoom})` }}
              />
            </Dialog.Trigger>
          )}

          {!failed && (
            <span className="absolute top-2 right-2 flex translate-y-1 gap-1 rounded-lg border border-border bg-background/90 p-1 opacity-0 shadow-sm backdrop-blur-sm transition-[opacity,transform] duration-200 group-focus-within/image:translate-y-0 group-focus-within/image:opacity-100 group-hover/image:translate-y-0 group-hover/image:opacity-100">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Open image preview"
                title="Preview"
                onClick={() => setPreviewOpen(true)}
              >
                <Maximize2 />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Zoom out image"
                title="Zoom out"
                disabled={zoom <= MIN_ZOOM}
                onClick={zoomOut}
              >
                <ZoomOut />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Zoom in image"
                title="Zoom in"
                disabled={zoom >= MAX_ZOOM}
                onClick={zoomIn}
              >
                <ZoomIn />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Download ${alt}`}
                title="Download"
                render={<a href={src} download={alt} />}
              >
                <Download />
              </Button>
            </span>
          )}
        </span>

        <figcaption
          className="mt-1.5 block max-w-full truncate text-right font-mono text-[10px] text-muted-foreground"
          title={location}
        >
          {location}
        </figcaption>
      </figure>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 min-h-dvh bg-background/85 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute" />
        <Dialog.Viewport
          className="fixed inset-y-0 right-0 flex min-h-dvh items-center justify-center p-3 sm:p-6"
          style={{ left: sidebarOffset }}
        >
          <Dialog.Popup className="flex h-[min(92dvh,64rem)] w-[min(96%,96rem)] flex-col overflow-hidden rounded-xl border border-border-strong bg-card shadow-2xl transition-[scale,opacity] duration-200 outline-none data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            <Dialog.Title className="sr-only">Image preview: {alt}</Dialog.Title>

            <ScrollArea
              horizontal
              className="min-h-0 flex-1 bg-muted/40"
              contentClassName="flex min-h-full min-w-full items-center p-4 sm:p-8"
            >
              <img
                src={src}
                alt={alt}
                className="mx-auto block h-auto max-w-none object-contain"
                style={{
                  width: previewZoom === 1 ? 'auto' : `${previewZoom * 100}%`,
                  maxWidth: previewZoom <= 1 ? '100%' : 'none',
                  maxHeight: previewZoom === 1 ? '100%' : 'none',
                }}
              />
            </ScrollArea>

            <div className="flex min-w-0 items-center justify-between gap-3 border-t border-border bg-card px-3 py-2">
              <span
                className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground"
                title={location}
              >
                {location}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Zoom out preview"
                  title="Zoom out"
                  disabled={previewZoom <= MIN_ZOOM}
                  onClick={previewZoomOut}
                >
                  <ZoomOut />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Reset preview zoom"
                  title="Reset zoom"
                  disabled={previewZoom === 1}
                  onClick={() => setPreviewZoom(1)}
                >
                  <RotateCcw />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Zoom in preview"
                  title="Zoom in"
                  disabled={previewZoom >= MAX_ZOOM}
                  onClick={previewZoomIn}
                >
                  <ZoomIn />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Download ${alt} from preview`}
                  title="Download"
                  render={<a href={src} download={alt} />}
                >
                  <Download />
                </Button>
                <Dialog.Close
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Close preview"
                    />
                  }
                >
                  <X />
                </Dialog.Close>
              </span>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
