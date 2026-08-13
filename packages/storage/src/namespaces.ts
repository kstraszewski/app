import { StorageNamespaceError } from './errors.ts'

export type StorageAccess = 'private' | 'public'

export interface StorageNamespaceDefinition {
  readonly access: StorageAccess
  readonly maxBytes: number
  readonly allowedContentTypes?: readonly string[]
}

export const STORAGE_NAMESPACE_DEFINITIONS = Object.freeze({
  'mortgage-source-documents': Object.freeze({
    access: 'private',
    maxBytes: 20 * 1024 * 1024,
  }),
  'mortgage-bank-logos': Object.freeze({
    access: 'public',
    maxBytes: 2 * 1024 * 1024,
    allowedContentTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp']),
  }),
  'crm-case-documents': Object.freeze({
    access: 'private',
    maxBytes: 25 * 1024 * 1024,
    allowedContentTypes: Object.freeze(['application/pdf', 'image/jpeg', 'image/png']),
  }),
  'crm-legal-documents': Object.freeze({
    access: 'private',
    maxBytes: 5 * 1024 * 1024,
    allowedContentTypes: Object.freeze(['application/pdf']),
  }),
  'crm-message-attachments': Object.freeze({
    access: 'private',
    maxBytes: 25 * 1024 * 1024,
    allowedContentTypes: Object.freeze([
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/csv',
    ]),
  }),
  'crm-property-images': Object.freeze({
    access: 'private',
    maxBytes: 8 * 1024 * 1024,
    allowedContentTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  }),
  'facility-images': Object.freeze({
    access: 'private',
    maxBytes: 8 * 1024 * 1024,
    allowedContentTypes: Object.freeze(['image/webp']),
  }),
  'expert-brand-assets': Object.freeze({
    access: 'public',
    maxBytes: 5 * 1024 * 1024,
    allowedContentTypes: Object.freeze(['image/webp']),
  }),
  'mortgage-bank-files': Object.freeze({
    access: 'private',
    maxBytes: 50 * 1024 * 1024,
    allowedContentTypes: Object.freeze([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
    ]),
  }),
} as const satisfies Record<string, StorageNamespaceDefinition>)

export type StorageNamespace = keyof typeof STORAGE_NAMESPACE_DEFINITIONS

export const STORAGE_NAMESPACES = Object.freeze(
  Object.keys(STORAGE_NAMESPACE_DEFINITIONS),
) as readonly StorageNamespace[]

export function isStorageNamespace(value: string): value is StorageNamespace {
  return Object.hasOwn(STORAGE_NAMESPACE_DEFINITIONS, value)
}

export function getStorageNamespaceDefinition(
  namespace: StorageNamespace,
): StorageNamespaceDefinition {
  if (!isStorageNamespace(namespace)) {
    throw new StorageNamespaceError(`Unknown storage namespace: ${String(namespace)}`)
  }

  return STORAGE_NAMESPACE_DEFINITIONS[namespace]
}
