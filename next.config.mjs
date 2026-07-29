/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Only exclude data here. Build-artifact directories (dist, .electron-staging,
  // out, build, videos, docs) are pruned from the staging tree in
  // scripts/prepare-electron.mjs instead. Excluding "./dist/**/*" via tracing
  // globs matches too broadly and strips node_modules/**/dist entry files
  // (e.g. next's package.json), breaking require('next') at runtime.
  outputFileTracingExcludes: {
    '*': ['./data/**/*'],
  },
  outputFileTracingIncludes: {
    '*': ['./node_modules/next/dist/lib/metadata/**/*'],
  },
  serverExternalPackages: ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai'],
}

export default nextConfig
