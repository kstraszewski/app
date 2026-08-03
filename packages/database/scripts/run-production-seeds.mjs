import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUN_VALUE = 'showcase-and-bank-files'

if (process.env.OPENEXPERT_RUN_PRODUCTION_SEEDS !== RUN_VALUE) {
  console.log('Production data seeds: skipped.')
  process.exit(0)
}

if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') {
  throw new Error('Production data seeds can run only in a Vercel production build.')
}

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const commands = [
  [
    resolve(scriptsDirectory, 'seed-production-showcase.mjs'),
    '--apply',
    '--confirm',
    'SEED_OPENEXPERT_PRODUCTION_SHOWCASE',
  ],
  [
    resolve(scriptsDirectory, 'seed-official-bank-files.mjs'),
    '--apply',
    '--confirm',
    'IMPORT_15_OFFICIAL_BANK_FILES_TO_PRODUCTION',
  ],
]

for (const argumentsList of commands) {
  const result = spawnSync(process.execPath, argumentsList, {
    cwd: resolve(scriptsDirectory, '../../..'),
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${argumentsList[0]} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

console.log('All requested production data seeds completed.')
