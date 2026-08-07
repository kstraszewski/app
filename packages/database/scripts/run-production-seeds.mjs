import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHOWCASE_COMMAND = [
  resolve(dirname(fileURLToPath(import.meta.url)), 'seed-production-showcase.mjs'),
  '--apply',
  '--confirm',
  'SEED_OPENEXPERT_PRODUCTION_SHOWCASE',
]
const KNOWLEDGE_MIGRATION_COMMAND = [
  resolve(dirname(fileURLToPath(import.meta.url)), 'migrate-production-knowledge-release.mjs'),
  '--apply',
  '--confirm',
  'MIGRATE_OPENEXPERT_PRODUCTION_KNOWLEDGE_RELEASE',
]
const BANK_FILES_COMMAND = [
  resolve(dirname(fileURLToPath(import.meta.url)), 'seed-official-bank-files.mjs'),
  '--apply',
  '--confirm',
  'IMPORT_15_OFFICIAL_BANK_FILES_TO_PRODUCTION',
]
const runMode = String(process.env.OPENEXPERT_RUN_PRODUCTION_SEEDS ?? '').trim()
const isProductionBuild = process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production'

function runCommand(argumentsList) {
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

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))

if (isProductionBuild) {
  runCommand(KNOWLEDGE_MIGRATION_COMMAND)
}
else {
  console.log('Production knowledge release migrations: skipped.')
}

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

if (!isProductionBuild) {
  throw new Error('Production data seeds can run only in a Vercel production build.')
}

for (const argumentsList of commands) {
  runCommand(argumentsList)
}

console.log('All requested production data seeds completed.')
