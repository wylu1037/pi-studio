import { defineConfig } from 'kubb'
import { pluginOas } from '@kubb/plugin-oas'
import { pluginTs } from '@kubb/plugin-ts'
import { pluginZod } from '@kubb/plugin-zod'
import { pluginClient } from '@kubb/plugin-client'
import { pluginReactQuery } from '@kubb/plugin-react-query'

export default defineConfig({
  input: {
    path: './openapi.json',
  },
  output: {
    path: './lib/api/generated',
    clean: true,
  },
  plugins: [
    pluginOas(),
    pluginTs(),
    pluginZod(),
    pluginClient(),
    pluginReactQuery(),
  ],
})
