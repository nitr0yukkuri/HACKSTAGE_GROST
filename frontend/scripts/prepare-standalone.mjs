import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const standaloneDirectory = join(frontendDirectory, '.next', 'standalone')
const standaloneFrontendDirectory = join(standaloneDirectory, 'frontend')
const standaloneNextDirectory = join(standaloneFrontendDirectory, '.next')

await mkdir(standaloneNextDirectory, { recursive: true })
await cp(
  join(frontendDirectory, '.next', 'static'),
  join(standaloneNextDirectory, 'static'),
  { recursive: true, force: true },
)
await cp(
  join(frontendDirectory, 'public'),
  join(standaloneFrontendDirectory, 'public'),
  { recursive: true, force: true },
)
