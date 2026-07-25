import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  FACILITY_IMAGES_BUCKET,
  seedDemoFacilityImages,
} from '../scripts/demo-facility-images.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

test('seeduje trzy zoptymalizowane zdjęcia galerii placówki', async () => {
  const uploads = []
  const upserts = []

  const adminClient = {
    storage: {
      from(bucket) {
        return {
          async upload(path, file, options) {
            uploads.push({ bucket, path, file, options })
            return { error: null }
          },
        }
      },
    },
    from(table) {
      return {
        upsert(rows, options) {
          upserts.push({ table, rows, options })
          return {
            async select() {
              return { data: rows, error: null }
            },
          }
        },
      }
    },
  }

  const result = await seedDemoFacilityImages({
    adminClient,
    profile: {
      id: '11111111-1111-4111-8111-111111111111',
      organization_id: '22222222-2222-4222-8222-222222222222',
    },
    facility: {
      id: '33333333-3333-4333-8333-333333333333',
    },
    repoRoot,
  })

  assert.equal(result.length, 3)
  assert.equal(uploads.length, 3)
  assert.equal(upserts.length, 1)
  assert.equal(upserts[0].table, 'facility_images')
  assert.deepEqual(upserts[0].options, { onConflict: 'id' })

  const hashes = new Set()

  uploads.forEach(({ bucket, path, file, options }, index) => {
    assert.equal(bucket, FACILITY_IMAGES_BUCKET)
    assert.equal(
      path,
      `22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/${
        ['exterior.webp', 'reception.webp', 'consultation-room.webp'][index]
      }`,
    )
    assert.equal(file.subarray(0, 4).toString('ascii'), 'RIFF')
    assert.equal(file.subarray(8, 12).toString('ascii'), 'WEBP')
    assert.ok(file.byteLength > 50_000)
    assert.deepEqual(options, {
      cacheControl: '31536000',
      contentType: 'image/webp',
      upsert: true,
    })
  })

  upserts[0].rows.forEach((row, index) => {
    assert.equal(row.sort_order, index)
    assert.equal(row.storage_bucket, FACILITY_IMAGES_BUCKET)
    assert.equal(row.width_px, 1448)
    assert.equal(row.height_px, 1086)
    assert.equal(row.mime_type, 'image/webp')
    assert.ok(row.size_bytes > 50_000)
    assert.equal(row.uploaded_by, '11111111-1111-4111-8111-111111111111')
    assert.ok(row.alt_text.length > 10)
    assert.match(row.sha256, /^[a-f0-9]{64}$/)
    hashes.add(row.sha256)
  })

  assert.equal(hashes.size, 3)
})
