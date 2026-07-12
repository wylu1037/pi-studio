/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-ai',
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
