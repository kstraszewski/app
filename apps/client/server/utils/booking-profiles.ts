export interface BookingProfileLink {
  organizationId: string
  clientPersonId: string
  person: {
    displayName: string
    role: string
    phone: string | null
  }
}

export interface BookingProfile {
  clientPersonId: string
  displayName: string
  role: string
  phone: string | null
}

export function bookingProfilesForOrganization(
  links: readonly BookingProfileLink[],
  organizationId: string,
): BookingProfile[] {
  return links
    .filter(link => link.organizationId === organizationId)
    .map(link => ({
      clientPersonId: link.clientPersonId,
      displayName: link.person.displayName,
      role: link.person.role,
      phone: link.person.phone,
    }))
}
