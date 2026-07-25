export interface DirectoryService {
  name: string
  durationMinutes: number
}

export interface DirectoryFacilityReference {
  name: string
  address: string | null
}

export interface DirectoryExpertReference {
  name: string
}

export interface DirectoryCoverImage {
  thumbnailUrl: string
  fallbackUrl: string
  alt: string
}

export interface DirectoryExpert {
  expertId: string
  name: string
  services: DirectoryService[]
  facilities: DirectoryFacilityReference[]
  widgetKey: string
}

export interface DirectoryFacility {
  facilityId: string
  name: string
  address: string | null
  timezone: string
  services: DirectoryService[]
  experts: DirectoryExpertReference[]
  widgetKey: string
  coverImage: DirectoryCoverImage | null
}

export interface DirectoryPayload {
  generatedAt: string
  experts: DirectoryExpert[]
  facilities: DirectoryFacility[]
}
