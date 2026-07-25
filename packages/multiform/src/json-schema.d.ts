declare module 'json-schema' {
  export type JSONSchema7Definition = JSONSchema7 | boolean

  export interface JSONSchema7 {
    [keyword: string]: unknown
  }
}
