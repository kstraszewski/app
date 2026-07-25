import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DIRECTORY_COVER_IMAGE_BATCH_SIZE,
  directoryCoverImagePayload,
  directoryFacilityIdBatches,
} from '../server/utils/directory-cover-images.ts'

describe('directoryFacilityIdBatches', () => {
  it('deduplicates facility ids and never exceeds the public lookup batch limit', () => {
    const facilityIds = Array.from(
      { length: DIRECTORY_COVER_IMAGE_BATCH_SIZE * 2 + 1 },
      (_, index) => `facility-${index}`,
    )
    const batches = directoryFacilityIdBatches([
      ...facilityIds,
      facilityIds[0]!,
      facilityIds[80]!,
    ])

    assert.deepEqual(
      batches.map(batch => batch.length),
      [DIRECTORY_COVER_IMAGE_BATCH_SIZE, DIRECTORY_COVER_IMAGE_BATCH_SIZE, 1],
    )
    assert.deepEqual(batches.flat(), facilityIds)
  })

  it('caps a caller-provided batch size at the public lookup limit', () => {
    const ids = Array.from({ length: 90 }, (_, index) => `facility-${index}`)
    const batches = directoryFacilityIdBatches(ids, 500)

    assert.equal(Math.max(...batches.map(batch => batch.length)), 80)
  })
})

describe('directoryCoverImagePayload', () => {
  it('returns only public URLs and accessible copy', () => {
    const payload = directoryCoverImagePayload(
      { alt_text: '  Wejście do placówki  ' },
      'OpenExpert Szczecin',
      'https://storage.example/thumbnail',
      'https://storage.example/original',
    )

    assert.deepEqual(payload, {
      thumbnailUrl: 'https://storage.example/thumbnail',
      fallbackUrl: 'https://storage.example/original',
      alt: 'Wejście do placówki',
    })
    assert.equal('storage_path' in payload, false)
    assert.equal('storage_bucket' in payload, false)
  })

  it('uses the facility name when stored alt text is empty', () => {
    const payload = directoryCoverImagePayload(
      { alt_text: ' ' },
      'OpenExpert Szczecin',
      'thumbnail',
      'original',
    )

    assert.equal(payload.alt, 'OpenExpert Szczecin — zdjęcie placówki')
  })
})
