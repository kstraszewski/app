import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(projectRoot, 'node_modules/sql.js/dist')
const destinations = [
  join(projectRoot, '.vercel/output/functions/__server.func/node_modules/sql.js/dist'),
  join(projectRoot, '.eve/nitro-output/flow/functions/__server.func/node_modules/sql.js/dist'),
]

for (const destination of destinations) {
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, { recursive: true, force: true })
}
