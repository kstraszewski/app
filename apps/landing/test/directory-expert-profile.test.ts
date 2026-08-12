import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  directoryExpertPath,
  directoryExpertRouteSlug,
  directoryExpertSlug,
  directoryExpertSlugMap,
} from '../shared/utils/directory-expert.ts'

describe('public expert profile slugs', () => {
  it('creates the expected readable Polish profile URL', () => {
    assert.equal(
      directoryExpertSlug('  Konrad Administracyjny  '),
      'konrad-administracyjny',
    )
    assert.equal(
      directoryExpertSlug('Łucja Żółć-Kowalska'),
      'lucja-zolc-kowalska',
    )
    assert.equal(
      directoryExpertPath('konrad-administracyjny'),
      '/eksperci/konrad-administracyjny',
    )
  })

  it('keeps unique names clean and disambiguates normalized collisions', () => {
    const slugs = directoryExpertSlugMap([
      { expertId: '11111111-1111-4111-8111-111111111111', name: 'Anna Nowak' },
      { expertId: '22222222-2222-4222-8222-222222222222', name: 'Anna Nowak' },
      { expertId: '33333333-3333-4333-8333-333333333333', name: 'Piotr Zieliński' },
    ])

    assert.equal(slugs.get('33333333-3333-4333-8333-333333333333'), 'piotr-zielinski')
    assert.equal(slugs.get('11111111-1111-4111-8111-111111111111'), 'anna-nowak-11111111')
    assert.equal(slugs.get('22222222-2222-4222-8222-222222222222'), 'anna-nowak-22222222')
    assert.equal(new Set(slugs.values()).size, 3)
  })

  it('accepts only canonical, bounded route values', () => {
    assert.equal(
      directoryExpertRouteSlug('konrad-administracyjny'),
      'konrad-administracyjny',
    )
    assert.equal(directoryExpertRouteSlug('Konrad-Administracyjny'), null)
    assert.equal(directoryExpertRouteSlug('../konrad'), null)
    assert.equal(directoryExpertRouteSlug('konrad_administracyjny'), null)
    assert.equal(directoryExpertRouteSlug('a'.repeat(161)), null)
    assert.equal(directoryExpertPath('../konrad'), '/eksperci')
  })
})
