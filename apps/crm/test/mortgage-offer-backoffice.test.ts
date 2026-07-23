import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeMortgageOfferBanksPayload,
  normalizeMortgageOfferDetail,
} from '../app/types/mortgage-offer-backoffice.ts'

test('keeps published and draft mortgage states independently', () => {
  const [bank] = normalizeMortgageOfferBanksPayload({
    data: [{
      id: 'bank-1',
      name: 'Bank',
      offers: [{
        id: 'offer-1',
        status: 'published',
        publicationStatus: 'published',
        hasPublishedVersion: true,
        hasDraft: true,
        publishedRevision: 3,
        draftRevision: 4,
      }],
    }],
  })

  assert.equal(bank?.offers[0]?.publicationStatus, 'published')
  assert.equal(bank?.offers[0]?.hasPublishedVersion, true)
  assert.equal(bank?.offers[0]?.hasDraft, true)
})

test('derives live plus draft flags from the legacy payload shape', () => {
  const [bank] = normalizeMortgageOfferBanksPayload({
    data: [{
      id: 'bank-1',
      name: 'Bank',
      offers: [{
        id: 'offer-1',
        status: 'draft',
        publishedRevision: 3,
        draftRevision: 4,
      }],
    }],
  })

  assert.equal(bank?.offers[0]?.publicationStatus, 'published')
  assert.equal(bank?.offers[0]?.hasPublishedVersion, true)
  assert.equal(bank?.offers[0]?.hasDraft, true)
})

test('keeps live and draft states independently in offer detail', () => {
  const detail = normalizeMortgageOfferDetail({
    data: {
      product: {
        id: 'offer-1',
        status: 'published',
        publicationStatus: 'published',
        hasPublishedVersion: true,
        hasDraft: true,
      },
      draft: { id: 'draft-1', revision: 4, status: 'draft', draftData: {} },
      versions: [{ id: 'version-3', revision: 3, status: 'published' }],
    },
  })

  assert.equal(detail?.product.publicationStatus, 'published')
  assert.equal(detail?.product.hasPublishedVersion, true)
  assert.equal(detail?.product.hasDraft, true)
  assert.equal(detail?.draft.status, 'draft')
})

test('keeps the calculator product kind separate from the legacy category', () => {
  const [bank] = normalizeMortgageOfferBanksPayload({
    data: [{
      id: 'bank-1',
      name: 'Bank',
      offers: [{
        id: 'offer-1',
        productKind: 'home_equity',
        category: 'housing',
        productType: 'housing',
      }],
    }],
  })

  assert.equal(bank?.offers[0]?.productKind, 'home_equity')
  assert.equal(bank?.offers[0]?.category, 'housing')
  assert.equal(bank?.offers[0]?.productType, 'housing')
})

test('normalizes the secured-loan compatibility alias without losing its kind', () => {
  const detail = normalizeMortgageOfferDetail({
    data: {
      product: {
        id: 'offer-1',
        productType: 'secured_loan',
      },
      draft: {},
      versions: [],
    },
  })

  assert.equal(detail?.product.productKind, 'home_equity')
  assert.equal(detail?.product.category, 'housing')
  assert.equal(detail?.product.productType, 'secured_loan')
})

test('preserves the legacy migration notice returned for an unsaved V2 seed', () => {
  const detail = normalizeMortgageOfferDetail({
    data: {
      product: { id: 'offer-1', productKind: 'mortgage', category: 'housing' },
      draft: {
        seededFromLegacy: true,
        seedWarnings: ['Sprawdź dane źródłowe.'],
        draftData: { schemaVersion: 'openexpert.mortgage-offer/2.0' },
      },
      versions: [],
    },
  })

  assert.equal(detail?.draft.seededFromLegacy, true)
  assert.deepEqual(detail?.draft.seedWarnings, ['Sprawdź dane źródłowe.'])
})
