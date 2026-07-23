import { access, cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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
    await cp(source, destination, { recursive: true, dereference: true, force: true })
  }
}
