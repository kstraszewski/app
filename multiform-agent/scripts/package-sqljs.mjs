import { access, cp, mkdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimePackages = [
  '@jitl/quickjs-ffi-types',
  '@jitl/quickjs-wasmfile-debug-asyncify',
  '@jitl/quickjs-wasmfile-debug-sync',
  '@jitl/quickjs-wasmfile-release-asyncify',
  '@jitl/quickjs-wasmfile-release-sync',
  '@mixmark-io/domino',
  '@mongodb-js/zstd',
  'balanced-match',
  'brace-expansion',
  'diff',
  'just-bash',
  'minimatch',
  'node-gyp-build',
  'node-liblzma',
  'quickjs-emscripten',
  'quickjs-emscripten-core',
  'seek-bzip',
  'sprintf-js',
  'sql.js',
  'turndown',
]
const outputRoots = [
  join(projectRoot, '.vercel/output/functions/__server.func/node_modules'),
  join(projectRoot, '.eve/nitro-output/flow/functions/__server.func/node_modules'),
]
const excludedRuntimeEntries = new Set([
  '.devcontainer',
  '.eslintrc.js',
  '.github',
  '.jsdoc.config.json',
  '.nojekyll',
  'AUTHORS',
  'CONTRIBUTING.md',
  'LICENSE',
  'LICENSE.md',
  'README.md',
  'documentation_index.md',
  'eslint.config.cjs',
  'logo.svg',
])

function includeRuntimeFile(source) {
  const name = basename(source)
  return !excludedRuntimeEntries.has(name)
    && !name.endsWith('.map')
    && !name.endsWith('.md')
}

for (const packageName of runtimePackages) {
  const sourceCandidates = [
    join(projectRoot, 'node_modules', packageName),
    join(projectRoot, 'node_modules/.pnpm/node_modules', packageName),
  ]
  let source

  for (const candidate of sourceCandidates) {
    try {
      await access(candidate)
      source = candidate
      break
    }
    catch {
      // Try the pnpm virtual store after the direct dependency location.
    }
  }

  if (!source) {
    throw new Error(`Unable to locate runtime package ${packageName}`)
  }

  for (const outputRoot of outputRoots) {
    const destination = join(outputRoot, packageName)
    await mkdir(dirname(destination), { recursive: true })
    await rm(destination, { recursive: true, force: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: includeRuntimeFile,
      force: true,
    })
  }
}
