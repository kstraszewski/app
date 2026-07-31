import { StoragePathError } from './errors.ts'
import type { StorageNamespace } from './namespaces.ts'

const MAX_STORAGE_PATH_BYTES = 1024
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:\//

interface PathValidationOptions {
  allowEmpty: boolean
  allowTrailingSlash: boolean
  label: string
}

function assertPathCandidate(
  candidate: string,
  options: PathValidationOptions,
): void {
  if (candidate === '') {
    if (options.allowEmpty) return
    throw new StoragePathError(`${options.label} cannot be empty`)
  }

  if (candidate.startsWith('/') || WINDOWS_ABSOLUTE_PATH_PATTERN.test(candidate)) {
    throw new StoragePathError(`${options.label} must be relative`)
  }

  if (candidate.includes('\\')) {
    throw new StoragePathError(`${options.label} cannot contain backslashes`)
  }

  if (candidate.includes('?') || candidate.includes('#')) {
    throw new StoragePathError(`${options.label} cannot contain URL query or fragment markers`)
  }

  if (CONTROL_CHARACTER_PATTERN.test(candidate)) {
    throw new StoragePathError(`${options.label} cannot contain control characters`)
  }

  const segments = candidate.split('/')
  const lastSegment = segments.at(-1)
  if (lastSegment === '' && options.allowTrailingSlash) segments.pop()

  if (segments.length === 0 || segments.some(segment => segment === '')) {
    throw new StoragePathError(`${options.label} cannot contain empty path segments`)
  }

  if (segments.some(segment => segment === '.' || segment === '..')) {
    throw new StoragePathError(`${options.label} cannot contain "." or ".." segments`)
  }
}

function assertNoEncodedSeparators(source: string, decoded: string, label: string): void {
  const sourceSeparators = (source.match(/[\\/]/g) ?? []).length
  const decodedSeparators = (decoded.match(/[\\/]/g) ?? []).length

  if (sourceSeparators !== decodedSeparators) {
    throw new StoragePathError(`${label} cannot contain encoded path separators`)
  }
}

function validateStoragePath(
  value: string,
  options: PathValidationOptions,
): string {
  if (typeof value !== 'string') {
    throw new StoragePathError(`${options.label} must be a string`)
  }

  const normalized = value.normalize('NFC')
  if (new TextEncoder().encode(normalized).byteLength > MAX_STORAGE_PATH_BYTES) {
    throw new StoragePathError(
      `${options.label} cannot exceed ${MAX_STORAGE_PATH_BYTES} UTF-8 bytes`,
    )
  }

  assertPathCandidate(normalized, options)

  let decoded = normalized
  for (let depth = 0; depth < 5; depth += 1) {
    let next: string
    try {
      next = decodeURIComponent(decoded)
    }
    catch (error) {
      throw new StoragePathError(`${options.label} contains invalid percent encoding`, {
        cause: error,
      })
    }

    if (next === decoded) break
    assertNoEncodedSeparators(decoded, next, options.label)
    assertPathCandidate(next, options)
    decoded = next
  }

  if (/%(?:25|2e|2f|5c)/i.test(decoded)) {
    throw new StoragePathError(`${options.label} contains excessive percent encoding`)
  }

  return normalized
}

export function assertSafeStoragePath(path: string): string {
  return validateStoragePath(path, {
    allowEmpty: false,
    allowTrailingSlash: false,
    label: 'Storage path',
  })
}

export function assertSafeStoragePrefix(prefix: string): string {
  return validateStoragePath(prefix, {
    allowEmpty: true,
    allowTrailingSlash: true,
    label: 'Storage prefix',
  })
}

export function toProviderKey(namespace: StorageNamespace, path: string): string {
  return `${namespace}/${assertSafeStoragePath(path)}`
}

export function toProviderPrefix(namespace: StorageNamespace, prefix: string): string {
  const safePrefix = assertSafeStoragePrefix(prefix)
  return safePrefix === '' ? `${namespace}/` : `${namespace}/${safePrefix}`
}

export function fromProviderKey(namespace: StorageNamespace, key: string): string {
  const namespacePrefix = `${namespace}/`
  if (!key.startsWith(namespacePrefix)) {
    throw new StoragePathError(
      `Provider key "${key}" is outside namespace "${namespace}"`,
    )
  }

  return assertSafeStoragePath(key.slice(namespacePrefix.length))
}
