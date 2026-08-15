import { useRuntimeConfig } from '#imports'
import type { H3Event } from 'h3'
import type { CeidgCompanyLookupResponse } from '../../shared/types/ceidg-company'
import { lookupCeidgCompany } from './ceidg-company'

export async function lookupConfiguredCeidgCompany(
  event: H3Event,
  nip: string,
): Promise<CeidgCompanyLookupResponse> {
  const config = useRuntimeConfig(event)
  const ceidg = config.ceidg as { apiBaseUrl?: string, token?: string }
  const company = await lookupCeidgCompany({
    apiBaseUrl: ceidg.apiBaseUrl || 'https://dane.biznes.gov.pl',
    nip,
    token: ceidg.token || '',
  })

  return {
    company,
    source: {
      provider: 'CEIDG',
      apiVersion: 'v3',
      retrievedAt: new Date().toISOString(),
    },
  }
}
