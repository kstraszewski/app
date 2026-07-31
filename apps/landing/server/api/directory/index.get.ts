import { createError } from 'h3'
import type { DirectoryPayload } from '#shared/types/directory'
import {
  buildDirectory,
  directoryCatalogSnapshot,
  type DirectoryCatalogSnapshot,
} from '../../utils/directory-catalog'
import { loadDirectoryCoverImages } from '../../utils/directory-cover-images'
import { loadDirectoryFacilityMetadata } from '../../utils/directory-facilities'
import { serverDataBackend } from '../../utils/data-api'

const WIDGET_PAGE_SIZE = 200
const RPC_BATCH_SIZE = 20
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function textValue(value: unknown, maxLength = 300): string {
  return typeof value === 'string'
    ? value.trim().slice(0, maxLength)
    : ''
}

export default defineCachedEventHandler(async (event): Promise<DirectoryPayload> => {
  const backendData = serverDataBackend(event)
  const widgetKeys: string[] = []

  for (let from = 0; ; from += WIDGET_PAGE_SIZE) {
    const { data, error } = await backendData
      .from('booking_widgets')
      .select('public_token')
      .eq('is_active', true)
      // The opt-in column is introduced by the directory migration. Keep this
      // query usable before the generated database types are refreshed.
      .eq('is_directory_listed' as never, true)
      .eq('widget_type', 'calendar')
      .order('public_token')
      .range(from, from + WIDGET_PAGE_SIZE - 1)

    if (error) {
      console.error('[directory] active calendar widgets query failed', {
        code: error.code,
        message: error.message,
      })
      throw createError({
        statusCode: 503,
        statusMessage: 'Katalog jest chwilowo niedostępny.',
      })
    }

    const pageKeys = (data ?? [])
      .map(row => textValue(row.public_token, 80))
      .filter(key => uuidPattern.test(key))
    widgetKeys.push(...pageKeys)
    if ((data ?? []).length < WIDGET_PAGE_SIZE) break
  }

  const catalogs: DirectoryCatalogSnapshot[] = []
  let rpcFailureCount = 0

  for (let start = 0; start < widgetKeys.length; start += RPC_BATCH_SIZE) {
    const batch = widgetKeys.slice(start, start + RPC_BATCH_SIZE)
    const results = await Promise.all(batch.map(async (widgetKey) => {
      const { data, error } = await backendData.rpc('get_booking_widget_catalog', {
        p_widget_token: widgetKey,
      })

      if (error) {
        rpcFailureCount += 1
        console.error('[directory] booking widget catalog RPC failed', {
          widgetKey,
          code: error.code,
          message: error.message,
        })
        return null
      }

      return directoryCatalogSnapshot(data, widgetKey)
    }))

    catalogs.push(...results.filter(
      (catalog): catalog is DirectoryCatalogSnapshot => Boolean(catalog),
    ))
  }

  if (widgetKeys.length > 0 && catalogs.length === 0 && rpcFailureCount > 0) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Katalog jest chwilowo niedostępny.',
    })
  }

  const directory = buildDirectory(catalogs)
  const [coverImages, metadata] = await Promise.all([
    loadDirectoryCoverImages(backendData, directory.facilities),
    loadDirectoryFacilityMetadata(backendData, directory.facilities),
  ])

  return {
    generatedAt: new Date().toISOString(),
    ...directory,
    facilities: directory.facilities.map((facility) => {
      const facilityMetadata = metadata.get(facility.facilityId)!
      return {
        ...facility,
        ...facilityMetadata,
        coverImage: coverImages.get(facility.facilityId) ?? null,
      }
    }),
  }
}, {
  name: 'public-directory',
  maxAge: 5 * 60,
  staleMaxAge: 10 * 60,
  swr: true,
})
