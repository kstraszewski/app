export interface CeidgPkdEntry {
  code: string
  name: string
}

export interface CeidgCompanyData {
  ceidgId: string
  name: string
  nip: string
  regon: string
  legalForm: string
  status: string
  businessAddress: string
  correspondenceAddress: string
  startDate: string
  suspensionDate: string
  resumeDate: string
  terminationDate: string
  removalDate: string
  mainPkd: CeidgPkdEntry | null
  pkd: CeidgPkdEntry[]
  email: string
  phone: string
  website: string
}

export interface CeidgCompanyLookupResponse {
  company: CeidgCompanyData
  source: {
    provider: 'CEIDG'
    apiVersion: 'v3'
    retrievedAt: string
  }
}
