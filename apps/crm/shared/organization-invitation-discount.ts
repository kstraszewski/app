import type { OrganizationInvitationBillingDiscount } from './types/system-organizations'

const PERCENTAGE_FORMATTER = new Intl.NumberFormat('pl-PL', {
  maximumFractionDigits: 2,
})

const PLN_FORMATTER = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function normalizePolishSpacing(value: string): string {
  return value.replace(/[\u00a0\u202f]/gu, ' ')
}

function polishMonthLabel(months: number): string {
  const lastTwoDigits = months % 100
  const lastDigit = months % 10

  if (months === 1) return 'miesiąc'
  if (lastTwoDigits >= 12 && lastTwoDigits <= 14) return 'miesięcy'
  if (lastDigit >= 2 && lastDigit <= 4) return 'miesiące'
  return 'miesięcy'
}

function durationLabel(discount: OrganizationInvitationBillingDiscount): string {
  if (discount.duration === 'once') return 'na pierwszą fakturę'
  if (discount.duration === 'forever') return 'przez cały okres subskrypcji'

  if (
    !Number.isInteger(discount.durationMonths)
    || discount.durationMonths === null
    || discount.durationMonths <= 0
  ) {
    return 'przez ograniczony czas'
  }

  return `przez ${discount.durationMonths} ${polishMonthLabel(discount.durationMonths)}`
}

export function invitationBillingDiscountLabel(
  discount: OrganizationInvitationBillingDiscount,
): string {
  const value = discount.kind === 'percentage'
    ? `${PERCENTAGE_FORMATTER.format(discount.percentOffBps / 100)}%`
    : normalizePolishSpacing(PLN_FORMATTER.format(discount.amountOffMinor / 100))

  return `${value} zniżki ${durationLabel(discount)}`
}

export const formatOrganizationInvitationBillingDiscount = invitationBillingDiscountLabel
