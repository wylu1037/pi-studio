import { resolve } from 'node:path'

export function piStudioDataDir() {
  return resolve(process.env.PI_STUDIO_DATA_DIR ?? 'data')
}
