import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FACILITY_IMAGES_BUCKET = 'facility-images'

const DEMO_FACILITY_IMAGES = [
  {
    id: 'd3200001-1000-4000-8000-000000000001',
    filename: 'exterior.webp',
    altText: 'Wejście do placówki OpenExpert Szczecin Centrum',
    sortOrder: 0,
  },
  {
    id: 'd3200001-1000-4000-8000-000000000002',
    filename: 'reception.webp',
    altText: 'Recepcja placówki OpenExpert Szczecin Centrum',
    sortOrder: 1,
  },
  {
    id: 'd3200001-1000-4000-8000-000000000003',
    filename: 'consultation-room.webp',
    altText: 'Pokój konsultacyjny w placówce OpenExpert Szczecin Centrum',
    sortOrder: 2,
  },
]

function assertNoError(error, context) {
  if (error) {
    throw new Error(`${context}: ${error.message}`)
  }
}

export async function seedDemoFacilityImages({
  adminClient,
  profile,
  facility,
  repoRoot,
}) {
  if (!profile?.id || !profile?.organization_id || !facility?.id) {
    throw new Error('Nie można dodać zdjęć bez użytkownika, organizacji i placówki.')
  }

  const preparedImages = DEMO_FACILITY_IMAGES.map((image) => {
    const filePath = resolve(
      repoRoot,
      'packages/database/data/facilities/szczecin-centrum',
      image.filename,
    )
    const file = readFileSync(filePath)

    return {
      ...image,
      file,
      sha256: createHash('sha256').update(file).digest('hex'),
      storagePath: `${profile.organization_id}/${facility.id}/${image.filename}`,
    }
  })

  for (const image of preparedImages) {
    const { error } = await adminClient.storage
      .from(FACILITY_IMAGES_BUCKET)
      .upload(image.storagePath, image.file, {
        cacheControl: '31536000',
        contentType: 'image/webp',
        upsert: true,
      })

    assertNoError(error, `Nie udało się wysłać zdjęcia ${image.filename}`)
  }

  const rows = preparedImages.map((image) => ({
    id: image.id,
    organization_id: profile.organization_id,
    facility_id: facility.id,
    storage_bucket: FACILITY_IMAGES_BUCKET,
    storage_path: image.storagePath,
    original_filename: image.filename,
    mime_type: 'image/webp',
    size_bytes: image.file.byteLength,
    alt_text: image.altText,
    sort_order: image.sortOrder,
    width_px: 1448,
    height_px: 1086,
    sha256: image.sha256,
    uploaded_by: profile.id,
  }))

  const { data, error } = await adminClient
    .from('facility_images')
    .upsert(rows, { onConflict: 'id' })
    .select('id, storage_path, sort_order')

  assertNoError(error, 'Nie udało się zapisać galerii placówki')

  return data ?? []
}

export { DEMO_FACILITY_IMAGES, FACILITY_IMAGES_BUCKET }
