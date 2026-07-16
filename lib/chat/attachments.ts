export type AttachmentUpload = {
  id: string
  name: string
  path: string
  size: number
  type: string
}

export const MAX_ATTACHMENT_COUNT = 10
export const MAX_ATTACHMENT_FILE_SIZE = 25 * 1024 * 1024
export const MAX_ATTACHMENT_TOTAL_SIZE = 50 * 1024 * 1024

const ATTACHMENT_CONTEXT_OPEN = '<pi-studio-attachments>'
const ATTACHMENT_CONTEXT_CLOSE = '</pi-studio-attachments>'
const ATTACHMENT_CONTEXT_GUIDANCE =
  'The user selected these files from the current workspace. Read them when relevant to the request.'

export function buildPromptWithAttachments(
  message: string,
  attachments: readonly Pick<AttachmentUpload, 'name' | 'path' | 'size' | 'type'>[],
) {
  const trimmedMessage = message.trim()
  if (attachments.length === 0) return trimmedMessage

  const manifest = attachments.map(({ name, path, size, type }) => ({
    name,
    path,
    size,
    type: type || 'application/octet-stream',
  }))
  const attachmentContext = [
    ATTACHMENT_CONTEXT_OPEN,
    ATTACHMENT_CONTEXT_GUIDANCE,
    JSON.stringify(manifest, null, 2),
    ATTACHMENT_CONTEXT_CLOSE,
  ].join('\n')

  return trimmedMessage ? `${trimmedMessage}\n\n${attachmentContext}` : attachmentContext
}

export function parsePromptWithAttachments(prompt: string): {
  message: string
  attachments: AttachmentUpload[]
} {
  const openIndex = prompt.lastIndexOf(ATTACHMENT_CONTEXT_OPEN)
  if (openIndex < 0 || !prompt.endsWith(ATTACHMENT_CONTEXT_CLOSE)) {
    return { message: prompt, attachments: [] }
  }

  const context = prompt.slice(openIndex)
  const jsonStart = context.indexOf('\n', ATTACHMENT_CONTEXT_OPEN.length)
  if (jsonStart < 0) return { message: prompt, attachments: [] }
  const guidanceEnd = context.indexOf('\n', jsonStart + 1)
  if (guidanceEnd < 0) return { message: prompt, attachments: [] }
  const jsonEnd = context.lastIndexOf(`\n${ATTACHMENT_CONTEXT_CLOSE}`)
  if (jsonEnd < 0) return { message: prompt, attachments: [] }

  try {
    const value = JSON.parse(context.slice(guidanceEnd + 1, jsonEnd)) as unknown
    if (!Array.isArray(value)) return { message: prompt, attachments: [] }
    const attachments = value.flatMap((item, index): AttachmentUpload[] => {
      if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
      if (
        typeof record.name !== 'string' ||
        typeof record.path !== 'string' ||
        typeof record.size !== 'number' ||
        typeof record.type !== 'string'
      ) {
        return []
      }
      return [
        {
          id: `prompt-attachment-${index}-${record.path}`,
          name: record.name,
          path: record.path,
          size: record.size,
          type: record.type,
        },
      ]
    })
    if (attachments.length !== value.length) return { message: prompt, attachments: [] }
    return {
      message: prompt.slice(0, openIndex).trimEnd(),
      attachments,
    }
  } catch {
    return { message: prompt, attachments: [] }
  }
}
