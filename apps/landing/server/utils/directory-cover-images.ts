import type { OpenExpertDataClient } from './platform-data'
import type {
  DirectoryCoverImage,
  DirectoryFacility,
  DirectoryFacilityGalleryImage,
} from '../../shared/types/directory'

export const DIRECTORY_COVER_IMAGE_BATCH_SIZE = 80

const FACILITY_IMAGES_BUCKET = 'facility-images'
const COVER_IMAGE_SIGNED_URL_TTL_SECONDS = 60 * 60
const COVER_IMAGE_SIGNING_CONCURRENCY = 8
const COVER_IMAGE_TRANSFORM = {
  width: 720,
  height: 405,
  resize: 'cover',
  quality: 76,
} as const
const GALLERY_IMAGE_TRANSFORM = {
  width: 1280,
  quality: 82,
} as const

const BUNDLED_FACILITY_IMAGES = new Map<string, string>([
  ['openexpert-szczecin', 'Wejście do placówki'],
  ['openexpert-warszawa-srodmiescie', 'Recepcja placówki'],
  ['openexpert-poznan-jezyce', 'Pokój konsultacyjny w placówce'],
  ['openexpert-wroclaw-centrum', 'Pokój konsultacyjny w placówce'],
  ['openexpert-gdansk-wrzeszcz', 'Recepcja placówki'],
])

type BackendDataClient = OpenExpertDataClient
type PublishedFacility = Pick<DirectoryFacility, 'facilityId' | 'name'>

interface FacilityImageRow {
  id: string
  facility_id: string
  storage_bucket: string
  storage_path: string
  alt_text: string | null
}

interface FacilityWithCoverImageRow {
  id: string
  facility_images: FacilityImageRow[]
}

export function directoryFacilityIdBatches(
  facilityIds: string[],
  batchSize = DIRECTORY_COVER_IMAGE_BATCH_SIZE,
): string[][] {
  const size = Math.max(1, Math.min(
    DIRECTORY_COVER_IMAGE_BATCH_SIZE,
    Math.floor(batchSize),
  ))
  const uniqueIds = [...new Set(facilityIds.filter(Boolean))]
  const batches: string[][] = []

  for (let start = 0; start < uniqueIds.length; start += size) {
    batches.push(uniqueIds.slice(start, start + size))
  }

  return batches
}

export function directoryCoverImagePayload(
  image: Pick<FacilityImageRow, 'alt_text'>,
  facilityName: string,
  thumbnailUrl: string,
  fallbackUrl: string,
): DirectoryCoverImage {
  return {
    thumbnailUrl,
    fallbackUrl,
    alt: image.alt_text?.trim() || `${facilityName} — zdjęcie placówki`,
  }
}

export function directoryGalleryImagePayload(
  image: Pick<FacilityImageRow, 'alt_text'>,
  facilityName: string,
  thumbnailUrl: string,
  fallbackUrl: string,
): DirectoryFacilityGalleryImage {
  return directoryCoverImagePayload(
    image,
    facilityName,
    thumbnailUrl,
    fallbackUrl,
  )
}

export function directoryBundledFacilityImage(
  facilitySlug: string,
  facilityName: string,
): DirectoryCoverImage | null {
  const altPrefix = BUNDLED_FACILITY_IMAGES.get(facilitySlug)
  if (!altPrefix) return null

  const imageUrl = `/images/facilities/${facilitySlug}.webp`
  return {
    thumbnailUrl: imageUrl,
    fallbackUrl: imageUrl,
    alt: `${altPrefix} ${facilityName}`,
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }
  return String(error)
}

async function mapWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  mapper: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  if (!inputs.length) return []

  const results = new Array<Output>(inputs.length)
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, concurrency), inputs.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < inputs.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(inputs[currentIndex]!)
    }
  }))

  return results
}

async function firstFacilityImages(
  backendData: BackendDataClient,
  facilityIds: string[],
): Promise<FacilityImageRow[]> {
  const images: FacilityImageRow[] = []

  for (const batch of directoryFacilityIdBatches(facilityIds)) {
    try {
      const { data, error } = await backendData
        .from('facilities')
        .select(`
          id,
          facility_images!facility_images_facility_fkey (
            id,
            facility_id,
            storage_bucket,
            storage_path,
            alt_text
          )
        `)
        .in('id', batch)
        .order('sort_order', {
          referencedTable: 'facility_images',
          ascending: true,
        })
        .order('created_at', {
          referencedTable: 'facility_images',
          ascending: true,
        })
        .order('id', {
          referencedTable: 'facility_images',
          ascending: true,
        })
        .limit(1, { referencedTable: 'facility_images' })

      if (error) {
        console.error('[directory] cover image query failed', {
          code: error.code,
          message: error.message,
          facilityCount: batch.length,
        })
        continue
      }

      const rows = (data ?? []) as unknown as FacilityWithCoverImageRow[]
      for (const row of rows) {
        const image = Array.isArray(row.facility_images)
          ? row.facility_images[0]
          : null
        if (
          image
          && image.facility_id === row.id
          && image.storage_bucket === FACILITY_IMAGES_BUCKET
        ) {
          images.push(image)
        }
      }
    } catch (error) {
      console.error('[directory] cover image query failed', {
        message: errorMessage(error),
        facilityCount: batch.length,
      })
    }
  }

  return images
}

async function signDirectoryCoverImage(
  backendData: BackendDataClient,
  image: FacilityImageRow,
  facilityName: string,
): Promise<DirectoryCoverImage | null> {
  try {
    const storage = backendData.storage.from(FACILITY_IMAGES_BUCKET)
    const [thumbnailResult, fallbackResult] = await Promise.all([
      storage.createSignedUrl(
        image.storage_path,
        COVER_IMAGE_SIGNED_URL_TTL_SECONDS,
        { transform: COVER_IMAGE_TRANSFORM },
      ),
      storage.createSignedUrl(
        image.storage_path,
        COVER_IMAGE_SIGNED_URL_TTL_SECONDS,
      ),
    ])

    if (thumbnailResult.error) {
      console.warn('[directory] transformed cover image signing failed', {
        imageId: image.id,
        message: thumbnailResult.error.message,
      })
    }
    if (fallbackResult.error) {
      console.warn('[directory] original cover image signing failed', {
        imageId: image.id,
        message: fallbackResult.error.message,
      })
    }

    const thumbnailUrl = thumbnailResult.data?.signedUrl
      ?? fallbackResult.data?.signedUrl
    const fallbackUrl = fallbackResult.data?.signedUrl
      ?? thumbnailResult.data?.signedUrl
    if (!thumbnailUrl || !fallbackUrl) return null

    return directoryCoverImagePayload(
      image,
      facilityName,
      thumbnailUrl,
      fallbackUrl,
    )
  } catch (error) {
    console.warn('[directory] cover image signing failed', {
      imageId: image.id,
      message: errorMessage(error),
    })
    return null
  }
}

async function signDirectoryGalleryImage(
  backendData: BackendDataClient,
  image: FacilityImageRow,
  facilityName: string,
): Promise<DirectoryFacilityGalleryImage | null> {
  try {
    const storage = backendData.storage.from(FACILITY_IMAGES_BUCKET)
    const [thumbnailResult, fallbackResult] = await Promise.all([
      storage.createSignedUrl(
        image.storage_path,
        COVER_IMAGE_SIGNED_URL_TTL_SECONDS,
        { transform: GALLERY_IMAGE_TRANSFORM },
      ),
      storage.createSignedUrl(
        image.storage_path,
        COVER_IMAGE_SIGNED_URL_TTL_SECONDS,
      ),
    ])

    if (thumbnailResult.error) {
      console.warn('[directory] transformed gallery image signing failed', {
        imageId: image.id,
        message: thumbnailResult.error.message,
      })
    }
    if (fallbackResult.error) {
      console.warn('[directory] original gallery image signing failed', {
        imageId: image.id,
        message: fallbackResult.error.message,
      })
    }

    const thumbnailUrl = thumbnailResult.data?.signedUrl
      ?? fallbackResult.data?.signedUrl
    const fallbackUrl = fallbackResult.data?.signedUrl
      ?? thumbnailResult.data?.signedUrl
    if (!thumbnailUrl || !fallbackUrl) return null

    return directoryGalleryImagePayload(
      image,
      facilityName,
      thumbnailUrl,
      fallbackUrl,
    )
  }
  catch (error) {
    console.warn('[directory] gallery image signing failed', {
      imageId: image.id,
      message: errorMessage(error),
    })
    return null
  }
}

export async function loadDirectoryCoverImages(
  backendData: BackendDataClient,
  facilities: PublishedFacility[],
): Promise<Map<string, DirectoryCoverImage>> {
  const facilityNames = new Map(
    facilities.map(facility => [facility.facilityId, facility.name]),
  )
  const images = await firstFacilityImages(
    backendData,
    [...facilityNames.keys()],
  )
  const signedImages = await mapWithConcurrency(
    images,
    COVER_IMAGE_SIGNING_CONCURRENCY,
    async image => ({
      facilityId: image.facility_id,
      coverImage: await signDirectoryCoverImage(
        backendData,
        image,
        facilityNames.get(image.facility_id) ?? 'Placówka OpenExpert',
      ),
    }),
  )

  return new Map(signedImages.flatMap(({ facilityId, coverImage }) => (
    coverImage ? [[facilityId, coverImage] as const] : []
  )))
}

export async function loadDirectoryFacilityGallery(
  backendData: BackendDataClient,
  organizationId: string,
  facilityId: string,
  facilityName: string,
): Promise<DirectoryFacilityGalleryImage[]> {
  const { data, error } = await backendData
    .from('facility_images')
    .select(`
      id,
      facility_id,
      storage_bucket,
      storage_path,
      alt_text
    `)
    .eq('organization_id', organizationId)
    .eq('facility_id', facilityId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    console.error('[directory] gallery image query failed', {
      code: error.code,
      message: error.message,
      facilityId,
    })
    throw new Error('Directory gallery query failed.')
  }

  const images = ((data ?? []) as FacilityImageRow[]).filter(image => (
    image.facility_id === facilityId
    && image.storage_bucket === FACILITY_IMAGES_BUCKET
  ))
  const signedImages = await mapWithConcurrency(
    images,
    COVER_IMAGE_SIGNING_CONCURRENCY,
    image => signDirectoryGalleryImage(backendData, image, facilityName),
  )

  return signedImages.filter(
    (image): image is DirectoryFacilityGalleryImage => Boolean(image),
  )
}
