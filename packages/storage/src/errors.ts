export type StorageErrorCode =
  | 'configuration'
  | 'conflict'
  | 'namespace_invalid'
  | 'path_invalid'
  | 'provider_contract'
  | 'unsupported'
  | 'validation'

export class StorageError extends Error {
  readonly code: StorageErrorCode

  constructor(code: StorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StorageError'
    this.code = code
  }
}

export class StorageConfigurationError extends StorageError {
  constructor(message: string, options?: ErrorOptions) {
    super('configuration', message, options)
    this.name = 'StorageConfigurationError'
  }
}

export class StorageConflictError extends StorageError {
  constructor(message: string, options?: ErrorOptions) {
    super('conflict', message, options)
    this.name = 'StorageConflictError'
  }
}

export class StorageNamespaceError extends StorageError {
  constructor(message: string, options?: ErrorOptions) {
    super('namespace_invalid', message, options)
    this.name = 'StorageNamespaceError'
  }
}

export class StoragePathError extends StorageError {
  constructor(message: string, options?: ErrorOptions) {
    super('path_invalid', message, options)
    this.name = 'StoragePathError'
  }
}

export class StorageProviderContractError extends StorageError {
  constructor(message: string, options?: ErrorOptions) {
    super('provider_contract', message, options)
    this.name = 'StorageProviderContractError'
  }
}

export class StorageUnsupportedError extends StorageError {
  constructor(message: string, options?: ErrorOptions) {
    super('unsupported', message, options)
    this.name = 'StorageUnsupportedError'
  }
}

export class StorageValidationError extends StorageError {
  constructor(message: string, options?: ErrorOptions) {
    super('validation', message, options)
    this.name = 'StorageValidationError'
  }
}
