import { randomUUID } from 'node:crypto'
import { mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_FILE_SIZE,
  MAX_ATTACHMENT_TOTAL_SIZE,
  type AttachmentUpload,
} from './attachments'

export type { AttachmentUpload } from './attachments'

export const ATTACHMENT_DIRECTORY = '.pi-studio/attachments'
export { MAX_ATTACHMENT_COUNT, MAX_ATTACHMENT_FILE_SIZE, MAX_ATTACHMENT_TOTAL_SIZE }

export type AttachmentFile = {
  name: string
  size: number
  type?: string
  arrayBuffer(): Promise<ArrayBuffer>
}

export class AttachmentFilesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AttachmentFilesError'
  }
}

export function sanitizeAttachmentFilename(filename: string) {
  const normalized = basename(filename.replaceAll('\\', '/'))
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()

  const safe = normalized || 'attachment'
  return safe.length > 120 ? safe.slice(0, 120).trim() || 'attachment' : safe
}

export async function saveSessionAttachments(
  cwd: string,
  files: readonly AttachmentFile[],
): Promise<AttachmentUpload[]> {
  validateAttachmentFiles(files)

  const workspaceRoot = await resolveWorkspaceRoot(cwd)
  const studioRoot = resolve(workspaceRoot, '.pi-studio')
  await mkdir(studioRoot, { recursive: true })
  const realStudioRoot = await realpath(studioRoot)
  assertContainedPath(workspaceRoot, realStudioRoot)
  const attachmentRoot = resolve(realStudioRoot, 'attachments')
  await mkdir(attachmentRoot, { recursive: true })
  const realAttachmentRoot = await realpath(attachmentRoot)
  assertContainedPath(workspaceRoot, realAttachmentRoot)

  const savedPaths: string[] = []
  try {
    const uploads: AttachmentUpload[] = []
    for (const file of files) {
      const id = randomUUID()
      const name = sanitizeAttachmentFilename(file.name)
      const storedName = `${id}-${name}`
      const absolutePath = join(realAttachmentRoot, storedName)
      assertContainedPath(realAttachmentRoot, absolutePath)
      const bytes = Buffer.from(await file.arrayBuffer())
      if (bytes.byteLength !== file.size) {
        throw new AttachmentFilesError(`Unable to read ${name}.`, 400)
      }
      await writeFile(absolutePath, bytes, { flag: 'wx', mode: 0o600 })
      savedPaths.push(absolutePath)
      uploads.push({
        id,
        name,
        path: toWorkspacePath(relative(workspaceRoot, absolutePath)),
        size: file.size,
        type: file.type ?? '',
      })
    }
    return uploads
  } catch (error) {
    await Promise.all(savedPaths.map((path) => rm(path, { force: true })))
    if (error instanceof AttachmentFilesError) throw error
    throw new AttachmentFilesError('Unable to save the selected files.', 500)
  }
}

function validateAttachmentFiles(files: readonly AttachmentFile[]) {
  if (files.length === 0) {
    throw new AttachmentFilesError('Select at least one file.', 400)
  }
  if (files.length > MAX_ATTACHMENT_COUNT) {
    throw new AttachmentFilesError(`Select up to ${MAX_ATTACHMENT_COUNT} files at a time.`, 413)
  }

  let totalSize = 0
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new AttachmentFilesError('One of the selected files has an invalid size.', 400)
    }
    if (file.size > MAX_ATTACHMENT_FILE_SIZE) {
      throw new AttachmentFilesError(
        `${sanitizeAttachmentFilename(file.name)} exceeds the 25 MB file limit.`,
        413,
      )
    }
    totalSize += file.size
  }
  if (totalSize > MAX_ATTACHMENT_TOTAL_SIZE) {
    throw new AttachmentFilesError('The selected files exceed the 50 MB total limit.', 413)
  }
}

async function resolveWorkspaceRoot(cwd: string) {
  try {
    const root = await realpath(resolve(cwd))
    if (!(await stat(root)).isDirectory()) throw new Error('Not a directory')
    return root
  } catch {
    throw new AttachmentFilesError('The agent workspace was not found.', 404)
  }
}

function assertContainedPath(root: string, candidate: string) {
  const pathFromRoot = relative(root, candidate)
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new AttachmentFilesError('The attachment path is outside the agent workspace.', 403)
  }
}

function toWorkspacePath(path: string) {
  return path.split(sep).join('/')
}
