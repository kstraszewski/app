import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  downloadMailRemoteImage,
  MAIL_REMOTE_IMAGE_BYTE_LIMIT,
  PublicWebContentError,
  validateMailRemoteImageBytes,
} from '../server/utils/public-web-content.ts'

describe('mail remote image proxy', () => {
  it('recognizes supported raster image formats by their bytes', () => {
    const cases: Array<[Buffer, string]> = [
      [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
      [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
      [Buffer.from('RIFF0000WEBP', 'ascii'), 'image/webp'],
      [Buffer.from('GIF89a', 'ascii'), 'image/gif'],
      [Buffer.from('BM', 'ascii'), 'image/bmp'],
      [Buffer.from([0x00, 0x00, 0x01, 0x00]), 'image/x-icon'],
      [avifHeader(), 'image/avif'],
    ]

    for (const [data, mimeType] of cases) {
      assert.equal(validateMailRemoteImageBytes(data).mimeType, mimeType)
    }
  })

  it('rejects active content and MIME confusion', () => {
    assert.throws(
      () => validateMailRemoteImageBytes(Buffer.from('<svg onload="alert(1)"></svg>'), 'image/svg+xml'),
      (error: unknown) => error instanceof PublicWebContentError && error.statusCode === 415,
    )
    assert.throws(
      () => validateMailRemoteImageBytes(Buffer.from([0xff, 0xd8, 0xff]), 'text/html'),
      (error: unknown) => error instanceof PublicWebContentError && error.statusCode === 415,
    )
  })

  it('accepts generic binary headers but serves the detected type', () => {
    assert.equal(
      validateMailRemoteImageBytes(Buffer.from('GIF87a', 'ascii'), 'application/octet-stream').mimeType,
      'image/gif',
    )
  })

  it('uses a bounded response size', () => {
    assert.equal(MAIL_REMOTE_IMAGE_BYTE_LIMIT, 4 * 1024 * 1024)
  })

  it('rejects application hosts before attempting a network lookup', async () => {
    for (const sourceUrl of [
      'https://crm.openexpert.invalid/mail-image',
      'https://crm.openexpert.invalid./mail-image',
    ]) {
      await assert.rejects(
        downloadMailRemoteImage(sourceUrl, {
          forbiddenOrigins: ['https://crm.openexpert.invalid'],
        }),
        (error: unknown) => error instanceof PublicWebContentError
          && /wewnętrzny adres aplikacji/u.test(error.message),
      )
    }
  })
})

function avifHeader(): Buffer {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x61, 0x76, 0x69, 0x66,
    0x00, 0x00, 0x00, 0x00,
    0x61, 0x76, 0x69, 0x66,
    0x6d, 0x69, 0x66, 0x31,
  ])
}
