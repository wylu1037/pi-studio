'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_FILE_SIZE,
  MAX_ATTACHMENT_TOTAL_SIZE,
  type AttachmentUpload,
} from '@/lib/chat/attachments'

export type DraftAttachment = {
  id: string
  file: File
  state: 'idle' | 'uploading' | 'error' | 'done'
  upload?: AttachmentUpload
  error?: string
}

export function useChatAttachments({
  sessionId,
  onError,
}: {
  sessionId: string
  onError?: (message: string) => void
}) {
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const controllersRef = useRef(new Map<string, AbortController>())

  const reportError = useCallback(
    (message: string) => {
      onError?.(message)
      return message
    },
    [onError],
  )

  const clear = useCallback(() => {
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
    setAttachments([])
  }, [])

  useEffect(
    () => () => {
      for (const controller of controllersRef.current.values()) controller.abort()
      controllersRef.current.clear()
    },
    [],
  )
  useEffect(() => {
    clear()
  }, [clear, sessionId])

  const addFiles = useCallback(
    (selectedFiles: FileList | File[]) => {
      const files = Array.from(selectedFiles)
      if (files.length === 0) return

      const existing = new Set(
        attachments.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}`),
      )
      const unique = files.filter(
        (file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`),
      )
      const availableSlots = Math.max(0, MAX_ATTACHMENT_COUNT - attachments.length)
      if (unique.length > availableSlots) {
        reportError(`You can attach up to ${MAX_ATTACHMENT_COUNT} files.`)
      }

      const accepted: File[] = []
      let totalSize = attachments.reduce((sum, attachment) => sum + attachment.file.size, 0)
      for (const file of unique.slice(0, availableSlots)) {
        if (file.size > MAX_ATTACHMENT_FILE_SIZE) {
          reportError(`${file.name} exceeds the 25 MB file limit.`)
          continue
        }
        if (totalSize + file.size > MAX_ATTACHMENT_TOTAL_SIZE) {
          reportError('Attachments exceed the 50 MB total limit.')
          break
        }
        accepted.push(file)
        totalSize += file.size
      }

      setAttachments((current) => [
        ...current,
        ...accepted.map((file) => ({
          id: crypto.randomUUID(),
          file,
          state: 'idle' as const,
        })),
      ])
    },
    [attachments, reportError],
  )

  const uploadAttachment = useCallback(
    async (attachmentId: string) => {
      const attachment = attachments.find((candidate) => candidate.id === attachmentId)
      if (!attachment) return null
      if (attachment.upload) return attachment.upload

      const controller = new AbortController()
      controllersRef.current.set(attachmentId, controller)
      setAttachments((current) =>
        current.map((candidate) =>
          candidate.id === attachmentId
            ? { ...candidate, state: 'uploading', error: undefined }
            : candidate,
        ),
      )

      try {
        const body = new FormData()
        body.append('files', attachment.file)
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/attachments`, {
          method: 'POST',
          body,
          signal: controller.signal,
        })
        const result = (await response.json()) as {
          attachments?: AttachmentUpload[]
          error?: string
        }
        const upload = result.attachments?.[0]
        if (!response.ok || !upload) {
          throw new Error(result.error ?? `Unable to upload ${attachment.file.name}.`)
        }
        setAttachments((current) =>
          current.map((candidate) =>
            candidate.id === attachmentId
              ? { ...candidate, state: 'done', upload, error: undefined }
              : candidate,
          ),
        )
        return upload
      } catch (error) {
        if (controller.signal.aborted) return null
        const message = error instanceof Error ? error.message : 'Unable to upload this file.'
        setAttachments((current) =>
          current.map((candidate) =>
            candidate.id === attachmentId
              ? { ...candidate, state: 'error', error: message }
              : candidate,
          ),
        )
        reportError(message)
        return null
      } finally {
        controllersRef.current.delete(attachmentId)
      }
    },
    [attachments, reportError, sessionId],
  )

  const uploadAll = useCallback(async () => {
    const uploads = await Promise.all(
      attachments.map((attachment) => uploadAttachment(attachment.id)),
    )
    return uploads.every((upload): upload is AttachmentUpload => Boolean(upload)) ? uploads : null
  }, [attachments, uploadAttachment])

  const removeAttachment = useCallback((attachmentId: string) => {
    controllersRef.current.get(attachmentId)?.abort()
    controllersRef.current.delete(attachmentId)
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
  }, [])

  return {
    attachments,
    addFiles,
    clear,
    removeAttachment,
    retryAttachment: uploadAttachment,
    uploadAll,
    isUploading: attachments.some((attachment) => attachment.state === 'uploading'),
  }
}
