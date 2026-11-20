import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDirectory = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: resolve(frontendDirectory, '..'),
  },
}

export default nextConfig
