/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: {
    '*': ['./data/**/*'],
  },
  outputFileTracingIncludes: {
    '*': ['./node_modules/next/dist/lib/metadata/**/*'],
  },
  serverExternalPackages: ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai'],
}

export default nextConfig
