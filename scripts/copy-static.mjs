import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'frontend', 'dist')
const target = join(root, 'backend', 'static')

if (!existsSync(dist)) {
  console.error('frontend/dist missing — run npm run build in frontend first')
  process.exit(1)
}

mkdirSync(target, { recursive: true })
for (const name of ['assets', 'index.html', 'favicon.svg', 'icons.svg']) {
  const from = join(dist, name)
  const to = join(target, name)
  if (!existsSync(from)) continue
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
}
console.log('Copied frontend dist → backend/static')
