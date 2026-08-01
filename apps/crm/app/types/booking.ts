import type { MortgageCapacityPolicy } from '@openexpert/mortgage'
import type { BookingWidgetType } from '#shared/types/booking-calculators'

export interface PublicBookingWidget {
  key: string
  title: string
  subtitle: string | null
  theme: 'light' | 'dark' | 'auto'
  accentColor: string
  bookingMode: 'facility' | 'expert' | 'both'
  widgetType: BookingWidgetType
  fixedExpertUserId: string | null
}

export interface PublicBookingFacility {
  id: string
  name: string
  address: string | null
  timezone: string
}

export interface PublicBookingService {
  id: string
  name: string
  description: string | null
  durationMinutes: number
}

export interface PublicBookingExpert {
  userId: string
  name: string
  avatarUrl?: string | null
  roleLabel?: string | null
  serviceIds?: string[]
}

export interface PublicBookingConsent {
  definitionId: string
  versionId: string
  title: string
  content: string
  purpose: string
  channel: 'email' | 'sms' | 'phone' | 'messaging' | 'other'
  legalBasis: string
  isRequired: boolean
}

export interface PublicBookingWidgetPayload {
  widget: PublicBookingWidget
  facility: PublicBookingFacility
  services: PublicBookingService[]
  experts: PublicBookingExpert[]
  consents: PublicBookingConsent[]
  capacityPolicy: MortgageCapacityPolicy
  capacityPolicyRevision: number | null
}

export interface PublicBookingSlot {
  startsAt: string
  endsAt: string
  expertUserId: string
  expertName: string
}

export interface PublicBookingSlotsPayload {
  date: string
  endDate: string
  timezone: string
  slots: PublicBookingSlot[]
}

export interface PublicBookingConfirmation {
  portalActivation?: 'sent' | 'failed'
  appointment: {
    id: string
    status: string
    startsAt: string
    endsAt: string
    facilityName: string
    serviceName: string
    expertName: string
  }
}
