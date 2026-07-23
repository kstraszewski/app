export interface PropertyImportImageCandidate {
  url: string
  alt: string | null
  source: string
  selected: boolean
}

export interface PropertyImportPreview {
  previewId: string
  sourceUrl: string
  retrievedUrl: string
  extractedAt: string
  listingTitle: string | null
  description: string | null
  address: string | null
  city: string | null
  postalCode: string | null
  propertyType: 'apartment' | 'house' | 'plot' | 'commercial' | 'other' | null
  marketType: 'primary' | 'secondary' | 'rental' | 'other' | null
  priceAmount: number | null
  currency: string
  areaM2: number | null
  rooms: number | null
  floor: number | null
  buildingFloors: number | null
  yearBuilt: number | null
  landAreaM2: number | null
  monthlyFees: number | null
  ownership: string | null
  condition: string | null
  heating: string | null
  externalId: string | null
  sourcePublishedAt: string | null
  pricePerM2: number | null
  features: string[]
  confidence: number
  evidence: Array<{ field: string, snippet: string }>
  warnings: string[]
  images: PropertyImportImageCandidate[]
  import: {
    schemaVersion: 1
    provider: 'google-generative-ai' | 'vercel-ai-gateway'
    model: string
    urlContextStatus: string | null
    citations: Array<{ url: string, title: string | null }>
  }
}
