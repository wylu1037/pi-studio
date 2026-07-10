import { writeFileSync } from 'node:fs'
import { api } from '@/lib/api/app'

async function main() {
  const response = await api.request('/api/openapi.json')
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Unable to generate OpenAPI schema: ${response.status}\n${body}`)
  }

  const schema = await response.text()
  writeFileSync('openapi.json', schema)
  console.log('Wrote openapi.json')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
