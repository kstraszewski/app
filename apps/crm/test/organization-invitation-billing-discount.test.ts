import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatOrganizationInvitationBillingDiscount,
  invitationBillingDiscountLabel,
} from '../shared/organization-invitation-discount.ts'
import type { OrganizationInvitationBillingDiscount } from '../shared/types/system-organizations.ts'

describe('organization invitation billing discount label', () => {
  it('formats a percentage discount applied once', () => {
    const discount: OrganizationInvitationBillingDiscount = {
      kind: 'percentage',
      percentOffBps: 2_500,
      duration: 'once',
      durationMonths: null,
    }

    assert.equal(
      invitationBillingDiscountLabel(discount),
      '25% zniżki na pierwszą fakturę',
    )
  })

  it('formats fractional percentages and repeating duration in Polish', () => {
    const discount: OrganizationInvitationBillingDiscount = {
      kind: 'percentage',
      percentOffBps: 1_250,
      duration: 'repeating',
      durationMonths: 3,
    }

    assert.equal(
      invitationBillingDiscountLabel(discount),
      '12,5% zniżki przez 3 miesiące',
    )
  })

  it('uses Polish month inflection for repeating discounts', () => {
    const discount = (durationMonths: number): OrganizationInvitationBillingDiscount => ({
      kind: 'percentage',
      percentOffBps: 1_000,
      duration: 'repeating',
      durationMonths,
    })

    assert.equal(
      invitationBillingDiscountLabel(discount(1)),
      '10% zniżki przez 1 miesiąc',
    )
    assert.equal(
      invitationBillingDiscountLabel(discount(12)),
      '10% zniżki przez 12 miesięcy',
    )
    assert.equal(
      invitationBillingDiscountLabel(discount(22)),
      '10% zniżki przez 22 miesiące',
    )
  })

  it('formats a fixed PLN amount including minor units', () => {
    const discount: OrganizationInvitationBillingDiscount = {
      kind: 'fixed_amount',
      amountOffMinor: 1_999,
      currency: 'pln',
      duration: 'forever',
      durationMonths: null,
    }

    assert.equal(
      invitationBillingDiscountLabel(discount),
      '19,99 zł zniżki przez cały okres subskrypcji',
    )
  })

  it('uses a truthful fallback when repeating duration is missing', () => {
    const discount: OrganizationInvitationBillingDiscount = {
      kind: 'fixed_amount',
      amountOffMinor: 5_000,
      currency: 'pln',
      duration: 'repeating',
      durationMonths: null,
    }

    assert.equal(
      formatOrganizationInvitationBillingDiscount(discount),
      '50 zł zniżki przez ograniczony czas',
    )
  })
})
