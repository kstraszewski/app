import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHOWCASE_COMMAND = [
  resolve(dirname(fileURLToPath(import.meta.url)), 'seed-production-showcase.mjs'),
  '--apply',
  '--confirm',
  'SEED_OPENEXPERT_PRODUCTION_SHOWCASE',
]
const BANK_FILES_COMMAND = [
  resolve(dirname(fileURLToPath(import.meta.url)), 'seed-official-bank-files.mjs'),
  '--apply',
  '--confirm',
  'IMPORT_15_OFFICIAL_BANK_FILES_TO_PRODUCTION',
]
const runMode = String(process.env.OPENEXPERT_RUN_PRODUCTION_SEEDS ?? '').trim()

if (!runMode) {
  console.log('Production data seeds: skipped.')
  process.exit(0)
}

const commands = {
  'bank-files': [BANK_FILES_COMMAND],
  'showcase-and-bank-files': [SHOWCASE_COMMAND, BANK_FILES_COMMAND],
}[runMode]
if (!commands) {
  throw new Error(
    'OPENEXPERT_RUN_PRODUCTION_SEEDS must be bank-files or showcase-and-bank-files.',
  )
}

if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') {
  throw new Error('Production data seeds can run only in a Vercel production build.')
}

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))

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
