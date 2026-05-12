import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  ...(process.env.NEXT_PUBLIC_BASE_PATH ? { basePath: process.env.NEXT_PUBLIC_BASE_PATH } : {}),
  turbopack: {
    root: path.resolve(__dirname),
  },
}

export default nextConfig
