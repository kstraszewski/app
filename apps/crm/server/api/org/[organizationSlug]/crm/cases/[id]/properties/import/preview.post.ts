import { randomUUID } from 'node:crypto'
import { createError, readBody } from 'h3'
import { requireCrmCase } from '~~/server/utils/case-documents'
import { asRecord, getRequiredParam, requireCrmSession } from '~~/server/utils/crm'
import { analyzePropertyListing } from '~~/server/utils/property-import'
import {
  assertPublicWebUrl,
  fetchPropertyPage,
  parsePublicHttpUrl,
  PublicWebContentError,
  rankPropertyImageCandidates,
  type PropertyPageEvidence,
} from '~~/server/utils/public-web-content'

function requiredSourceUrl(input: unknown) {
  if (typeof input !== 'string' || !input.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Podaj link do ogłoszenia.' })
  }
  return input.trim()
}

function emptyEvidence(sourceUrl: string): PropertyPageEvidence {
  return {
    sourceUrl,
    finalUrl: sourceUrl,
    canonicalUrl: null,
    title: null,
    description: null,
    jsonLd: [],
    text: '',
    imageCandidates: [],
  }
}

function candidateUrl(input: string, baseUrl: string): string | null {
  try {
    return parsePublicHttpUrl(new URL(input, baseUrl).href).href
  }
  catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  await requireCrmCase(session, caseId)

  const body = asRecord(await readBody(event))
  const requestedUrl = requiredSourceUrl(body.url)
  const sourceUrl = (await assertPublicWebUrl(requestedUrl)).href
  let evidence = emptyEvidence(sourceUrl)
  const previewWarnings: string[] = []

  try {
    evidence = await fetchPropertyPage(sourceUrl)
  }
  catch (caught) {
    const message = caught instanceof PublicWebContentError
      ? caught.message
      : 'Nie udało się pobrać kodu strony.'
    previewWarnings.push(`${message} Gemini spróbuje odczytać link przez URL Context.`)
  }

  const runtimeConfig = useRuntimeConfig(event)
  let analysis
  try {
    analysis = await analyzePropertyListing(sourceUrl, evidence, {
      aiGatewayApiKey: runtimeConfig.aiGatewayApiKey,
      googleGenerativeAiApiKey: runtimeConfig.googleGenerativeAiApiKey,
    })
  }
  catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Analiza AI nie powiodła się.'
    const missingCredentials = message.includes('API_KEY') || message.includes('skonfigurowany')
    throw createError({
      statusCode: missingCredentials ? 503 : 422,
      statusMessage: missingCredentials
        ? 'Importer AI nie ma skonfigurowanego klucza AI Gateway lub Google.'
        : `Gemini nie zdołał przeanalizować ogłoszenia: ${message}`,
    })
  }

  const normalizedEvidenceImages = evidence.imageCandidates.flatMap((image) => {
    const url = candidateUrl(image.url, evidence.finalUrl)
    return url ? [{ ...image, url }] : []
  })
  const evidenceByUrl = new Map(normalizedEvidenceImages.map(image => [image.url, image]))
  const geminiImages = analysis.imageUrls.flatMap((rawUrl) => {
    const url = candidateUrl(rawUrl, evidence.finalUrl)
    if (!url) return []
    return [{
      url,
      alt: evidenceByUrl.get(url)?.alt ?? analysis.listingTitle,
      source: 'gemini',
    }]
  })

  // The model is responsible for identifying which gallery belongs to this
  // exact listing. Raw page images are only a fallback because otherwise
  // photos from related offers can be mixed into the preview.
  const imageCandidates = geminiImages.length ? geminiImages : normalizedEvidenceImages
  const uniqueImages = rankPropertyImageCandidates(imageCandidates, evidence.finalUrl, 20)
    .map((image, index) => ({ ...image, selected: index < 8 }))

  const urlContextSucceeded = analysis.urlContextStatus?.includes('SUCCESS') ?? false
  if (analysis.urlContextStatus && !urlContextSucceeded) {
    previewWarnings.push('Gemini nie potwierdził pełnego odczytu strony przez URL Context.')
  }
  if (!analysis.address) {
    previewWarnings.push('Ogłoszenie nie ujawnia pełnego adresu. Uzupełnij lokalizację przed zapisem.')
  }
  if (!uniqueImages.length) {
    previewWarnings.push('Nie znaleziono zdjęć możliwych do zapisania w CRM.')
  }

  const extractedAt = new Date().toISOString()
  return {
    data: {
      previewId: randomUUID(),
      sourceUrl,
      retrievedUrl: evidence.canonicalUrl ?? evidence.finalUrl,
      extractedAt,
      listingTitle: analysis.listingTitle,
      description: analysis.description,
      address: analysis.address,
      city: analysis.city,
      postalCode: analysis.postalCode,
      propertyType: analysis.propertyType,
      marketType: analysis.marketType,
      priceAmount: analysis.priceAmount,
      currency: analysis.currency,
      areaM2: analysis.areaM2,
      rooms: analysis.rooms,
      floor: analysis.floor,
      buildingFloors: analysis.buildingFloors,
      yearBuilt: analysis.yearBuilt,
      landAreaM2: analysis.landAreaM2,
      monthlyFees: analysis.monthlyFees,
      ownership: analysis.ownership,
      condition: analysis.condition,
      heating: analysis.heating,
      externalId: analysis.externalId,
      sourcePublishedAt: analysis.sourcePublishedAt,
      pricePerM2: analysis.pricePerM2,
      features: analysis.features,
      confidence: analysis.confidence,
      evidence: analysis.evidence,
      warnings: [...new Set([...previewWarnings, ...analysis.warnings])],
      images: uniqueImages,
      import: {
        schemaVersion: 1,
        provider: analysis.provider,
        model: analysis.model,
        urlContextStatus: analysis.urlContextStatus,
        citations: analysis.citations,
      },
    },
  }
})
