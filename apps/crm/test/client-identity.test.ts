import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appointmentMatchesVerifiedContact,
  hasMatchingVerifiedClientEmail,
} from '../server/utils/client-identity.ts'

const confirmedAt = '2026-07-25T12:00:00.000Z'

describe('hasMatchingVerifiedClientEmail', () => {
  it('accepts the same confirmed email across Auth, appointment and CRM person', () => {
    assert.equal(hasMatchingVerifiedClientEmail({
      authEmail: ' Client@Example.com ',
      emailConfirmedAt: confirmedAt,
      appointmentEmail: 'client@example.com',
      personEmailNormalized: 'client@example.com',
    }), true)
  })

  it('rejects an unconfirmed Auth email', () => {
    assert.equal(hasMatchingVerifiedClientEmail({
      authEmail: 'client@example.com',
      emailConfirmedAt: null,
      appointmentEmail: 'client@example.com',
      personEmailNormalized: 'client@example.com',
    }), false)
  })

  it('rejects an attacker booking that matched a victim CRM person by phone', () => {
    assert.equal(hasMatchingVerifiedClientEmail({
      authEmail: 'attacker@example.com',
      emailConfirmedAt: confirmedAt,
      appointmentEmail: 'attacker@example.com',
      personEmailNormalized: 'victim@example.com',
    }), false)
  })

  it('rejects an appointment snapshot belonging to a different email', () => {
    assert.equal(hasMatchingVerifiedClientEmail({
      authEmail: 'client@example.com',
      emailConfirmedAt: confirmedAt,
      appointmentEmail: 'other@example.com',
      personEmailNormalized: 'client@example.com',
    }), false)
  })

  it('rejects missing email evidence', () => {
    assert.equal(hasMatchingVerifiedClientEmail({
      authEmail: 'client@example.com',
      emailConfirmedAt: confirmedAt,
      appointmentEmail: null,
      personEmailNormalized: 'client@example.com',
    }), false)
  })

  it('does not loosen the database-normalized CRM person value', () => {
    assert.equal(hasMatchingVerifiedClientEmail({
      authEmail: 'client@example.com',
      emailConfirmedAt: confirmedAt,
      appointmentEmail: 'client@example.com',
      personEmailNormalized: 'client@example.com\u00a0',
    }), false)
  })
})

describe('appointmentMatchesVerifiedContact', () => {
  it('accepts an appointment made with the contact verified on the link', () => {
    assert.equal(
      appointmentMatchesVerifiedContact('client@example.com', 'Client@Example.com'),
      true,
    )
  })

  it('rejects future-data poisoning on the same CRM person', () => {
    assert.equal(
      appointmentMatchesVerifiedContact('attacker@example.com', 'victim@example.com'),
      false,
    )
  })

  it('rejects a malformed stored verification contact', () => {
    assert.equal(
      appointmentMatchesVerifiedContact(' client@example.com ', 'client@example.com'),
      false,
    )
  })
})
