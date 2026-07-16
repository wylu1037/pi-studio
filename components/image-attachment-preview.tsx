'use client'

import { useEffect, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function useObjectUrl(file?: File) {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    if (!file) {
      setUrl(undefined)
      return
    }

    const nextUrl = URL.createObjectURL(file)
    setUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])

  return url
}

export function isImageAttachment(name: string, type?: string) {
  return Boolean(type?.startsWith('image/') || /\.(?:avif|gif|jpe?g|png|webp)$/i.test(name))
}

export function ImageAttachmentPreview({
  alt,
  className,
  file,
  imageClassName,
  src,
}: {
  alt: string
  className?: string
  file?: File
  imageClassName?: string
  src?: string
}) {
  const [open, setOpen] = useState(false)
  const objectUrl = useObjectUrl(file)
  const imageSrc = src ?? objectUrl

  if (!imageSrc) return null

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <button
        type="button"
        className={cn(
          'group/image-preview relative block min-w-0 cursor-zoom-in overflow-hidden bg-muted transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]',
          className,
        )}
        aria-label={`Preview ${alt}`}
        onClick={() => setOpen(true)}
      >
        <img src={imageSrc} alt={alt} className={cn('size-full object-cover', imageClassName)} />
        <span className="sr-only">Open full-size image preview</span>
      </button>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-background/80 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Viewport className="fixed inset-0 flex items-center justify-center p-4 sm:p-8">
          <Dialog.Popup className="relative flex max-h-full max-w-full flex-col overflow-hidden border border-border-strong bg-card shadow-2xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <Dialog.Title className="sr-only">Image preview: {alt}</Dialog.Title>
            <img
              src={imageSrc}
              alt={alt}
              className="max-h-[calc(100dvh-6rem)] max-w-[calc(100vw-3rem)] object-contain sm:max-h-[calc(100dvh-8rem)] sm:max-w-[calc(100vw-6rem)]"
            />
            <div className="flex min-w-0 items-center justify-between gap-3 border-t border-border bg-card px-3 py-2">
              <span className="truncate text-xs text-muted-foreground" title={alt}>
                {alt}
              </span>
              <Dialog.Close
                render={
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Close preview" />
                }
              >
                <X />
              </Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
