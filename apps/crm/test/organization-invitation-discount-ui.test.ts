import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('superadmin invitation UI maps human values to the shared discount contract', () => {
  const page = source('../app/pages/org/[organizationSlug]/settings/organizations.vue')

  assert.match(page, /billingDiscountKind: z\.enum\(\['none', 'percentage', 'fixed_amount', 'free_period'\]\)/)
  assert.match(page, /percentOffBps:[\s\S]*Math\.round\(data\.billingDiscountPercent! \* 100\)/)
  assert.match(page, /amountOffMinor: Math\.round\(data\.billingDiscountAmount! \* 100\)/)
  assert.match(page, /data\.billingDiscountKind === 'free_period'[\s\S]*\? 10_000/)
  assert.match(page, /data\.billingDiscountDuration === 'repeating'[\s\S]*\? data\.billingDiscountDurationMonths[\s\S]*: null/)
  assert.match(page, /\.\.\.\(billingDiscount \? \{ billingDiscount \} : \{\}\)/)
})

test('intermediaries cannot retain or submit an invitation discount', () => {
  const page = source('../app/pages/org/[organizationSlug]/settings/organizations.vue')

  assert.match(page, /data\.organizationKind !== 'application' \|\| data\.billingDiscountKind === 'none'/)
  assert.match(page, /watch\(\(\) => inviteState\.organizationKind,[\s\S]*kind !== 'application'[\s\S]*resetInviteDiscount\(\)/)
  assert.match(page, /v-if="inviteState\.organizationKind === 'application'"[\s\S]*aria-labelledby="invitation-discount-title"/)
})

test('superadmin UI explains discount semantics and displays the assigned offer', () => {
  const page = source('../app/pages/org/[organizationSlug]/settings/organizations.vue')

  for (const label of ['Brak rabatu', 'Procent', 'Kwotowy PLN', 'Darmowy okres']) {
    assert.match(page, new RegExp(label))
  }
  for (const duration of ['Pierwsza faktura', 'Przez określoną liczbę miesięcy', 'Bezterminowo']) {
    assert.match(page, new RegExp(duration))
  }
  assert.match(page, /skaluje się wraz z liczbą miejsc/)
  assert.match(page, /odejmowana od całej miesięcznej faktury organizacji, a nie od każdego miejsca/)
  assert.match(page, /v-if="hasFullForeverDiscount"[\s\S]*Bezpłatna subskrypcja bez końca/)
  assert.match(page, /\{ id: 'offer', header: 'Oferta' \}/)
  assert.match(page, /#offer-cell[\s\S]*invitationBillingDiscountLabel\(row\.original\.billingDiscount\)/)
  assert.match(page, /Oferta przypisana do zaproszenia/)
})

test('public invitation shows an automatic grant before and after acceptance', () => {
  const page = source('../app/pages/organization-invitation.vue')

  assert.match(page, /const billingDiscount = computed\(\(\) => invitation\.value\?\.billingDiscount \?\? null\)/)
  assert.match(page, /Rabat automatyczny: \{\{ billingDiscountLabel \}\}/)
  assert.match(page, /Do zaproszenia przypisano \{\{ billingDiscountLabel \}\}/)
  assert.match(page, /v-else>[\s\S]*Kod promocyjny możesz wpisać w checkout/)
  assert.match(page, /v-else>[\s\S]*Kupon promocyjny wpiszesz w Stripe/)
})
