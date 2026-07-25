import { createHash } from 'node:crypto'

export const maxMortgageTemplatePdfBytes = 25 * 1024 * 1024

export type MortgageTemplatePdfValidation =
  | { valid: true, sha256: string }
  | {
      valid: false
      reason: 'too_large' | 'invalid_pdf' | 'checksum_mismatch'
      sha256?: string
    }

export function normalizeMortgageTemplatePdfAsset(value: unknown): Uint8Array | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  return null
}

export function validateMortgageTemplatePdf(
  bytes: Uint8Array,
  expectedSha256: string,
): MortgageTemplatePdfValidation {
  if (bytes.byteLength > maxMortgageTemplatePdfBytes) {
    return { valid: false, reason: 'too_large' }
  }

  if (
    bytes.byteLength < 5
    || bytes[0] !== 0x25
    || bytes[1] !== 0x50
    || bytes[2] !== 0x44
    || bytes[3] !== 0x46
    || bytes[4] !== 0x2D
  ) {
    return { valid: false, reason: 'invalid_pdf' }
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== expectedSha256.trim().toLocaleLowerCase('en-US')) {
    return { valid: false, reason: 'checksum_mismatch', sha256 }
  }

  return { valid: true, sha256 }
}
