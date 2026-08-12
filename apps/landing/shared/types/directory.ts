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
  avatarUrl?: string | null
}

export interface DirectoryCoverImage {
  thumbnailUrl: string
  fallbackUrl: string
  alt: string
}

export interface DirectoryCoordinates {
  latitude: number
  longitude: number
}

export interface DirectoryAvailabilityDate {
  localDate: string
  startsAt: string
  serviceId: string
}

export interface DirectoryExpertAvailability {
  status: 'available' | 'none' | 'unknown'
  timezone: string
  dates: DirectoryAvailabilityDate[]
}

export interface DirectoryExpert {
  expertId: string
  slug: string
  name: string
  avatarUrl?: string | null
  services: DirectoryService[]
  facilities: DirectoryFacilityReference[]
  widgetKey: string
  availability: DirectoryExpertAvailability
}

export interface DirectoryFacility {
  facilityId: string
  organizationSlug: string
  facilitySlug: string
  name: string
  address: string | null
  city: string | null
  timezone: string
  coordinates: DirectoryCoordinates | null
  services: DirectoryService[]
  experts: DirectoryExpertReference[]
  widgetKey: string
  coverImage: DirectoryCoverImage | null
}

export interface DirectoryFacilityContact {
  phone: string | null
  email: string | null
}

export interface DirectoryFacilityOpeningHour {
  weekday: number
  opensAt: string
  closesAt: string
}

export type DirectoryFacilityGalleryImage = DirectoryCoverImage

export interface DirectoryFacilityDetailService {
  serviceId: string
  slug: string
  name: string
  description: string | null
  durationMinutes: number
}

export interface DirectoryFacilityDetailExpert {
  expertId: string
  name: string
  avatarUrl?: string | null
  serviceIds: string[]
}

export interface DirectoryFacilityDetail {
  facilityId: string
  organizationSlug: string
  facilitySlug: string
  name: string
  description: string | null
  address: string | null
  addressLine1: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  countryCode: string
  timezone: string
  coordinates: DirectoryCoordinates | null
  contact: DirectoryFacilityContact
  openingHours: DirectoryFacilityOpeningHour[]
  gallery: DirectoryFacilityGalleryImage[]
  services: DirectoryFacilityDetailService[]
  experts: DirectoryFacilityDetailExpert[]
  widgetKey: string
}

export interface DirectoryPayload {
  generatedAt: string
  experts: DirectoryExpert[]
  facilities: DirectoryFacility[]
}
