import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  brandInitials,
  brandProfileCompletion,
  buildBrandMaterialContent,
  buildBrandPalette,
  contrastingTextColor,
  createEmptyExpertBrandProfile,
  normalizeExpertBrandProfile,
} from '../shared/brand.ts'
import { cloneDefaultOrganizationDesign } from '../shared/design.ts'

describe('expert Brand Core', () => {
  it('normalizes untrusted profile input and limits specializations', () => {
    const profile = normalizeExpertBrandProfile({
      brandName: '  Dobry Plan Finansowy  ',
      expertName: ' Anna Nowak ',
      professionalTitle: 'Ekspertka kredytowa',
      email: 'anna@example.com',
      specializations: [
        'Hipoteki',
        'Hipoteki',
        'Refinansowanie',
        'Pierwsze mieszkanie',
        'Budowa domu',
        'Kredyty firmowe',
        'Kredyty gotówkowe',
        'Ubezpieczenia',
        'Inwestycje',
      ],
      visualStyle: 'unsupported',
      logoUrl: 'javascript:alert(1)',
    })

    assert.equal(profile.brandName, 'Dobry Plan Finansowy')
    assert.equal(profile.expertName, 'Anna Nowak')
    assert.equal(profile.visualStyle, 'minimal')
    assert.equal(profile.logoUrl, null)
    assert.equal(profile.specializations.length, 8)
    assert.equal(new Set(profile.specializations).size, 8)
  })

  it('reports an actionable empty state and a complete profile', () => {
    const empty = brandProfileCompletion(createEmptyExpertBrandProfile())
    assert.equal(empty.percentage, 0)
    assert.ok(empty.missing.includes('logo'))
    assert.ok(empty.missing.includes('zdjęcie portretowe'))

    const complete = brandProfileCompletion({
      brandName: 'Dobry Plan',
      expertName: 'Anna Nowak',
      email: 'anna@example.com',
      bio: 'Pomagam klientom.',
      specializations: ['Hipoteki'],
      logoUrl: 'https://cdn.example.com/logo.webp',
      portraitUrl: 'https://cdn.example.com/portrait.webp',
    })
    assert.equal(complete.percentage, 100)
    assert.deepEqual(complete.missing, [])
  })

  it('builds deterministic content for all five material types', () => {
    const profile = normalizeExpertBrandProfile({
      brandName: 'Dobry Plan',
      expertName: 'Anna Nowak',
      professionalTitle: 'Ekspertka kredytowa',
      tagline: 'Finansowanie z dobrym planem.',
      email: 'anna@example.com',
      location: 'Szczecinie',
      bio: 'Porównuję scenariusze i prowadzę proces.',
      specializations: ['Kredyty hipoteczne'],
    })

    const types = ['linkedin', 'instagram', 'story', 'business-card', 'one-pager'] as const
    for (const type of types) {
      const first = buildBrandMaterialContent(profile, type)
      const second = buildBrandMaterialContent(profile, type)
      assert.deepEqual(first, second)
      assert.ok(first.eyebrow)
      assert.ok(first.headline)
      assert.ok(first.body)
      assert.ok(first.callToAction)
    }
    assert.equal(buildBrandMaterialContent(profile, 'business-card').headline, 'Anna Nowak')
  })

  it('uses organization design tokens as the shared material palette', () => {
    const design = cloneDefaultOrganizationDesign()
    design.colors.light.primary = '#123456'
    design.colors.light.secondary = '#fedcba'

    assert.deepEqual(buildBrandPalette(design), {
      primary: '#123456',
      secondary: '#fedcba',
      background: design.colors.light.background,
      surface: design.colors.light.backgroundMuted,
      foreground: design.colors.light.textHighlighted,
      muted: design.colors.light.textMuted,
    })
    assert.equal(contrastingTextColor('#123456'), '#ffffff')
    assert.equal(contrastingTextColor('#fedcba'), '#111111')
  })

  it('creates readable initials without requiring a logo', () => {
    assert.equal(brandInitials({ brandName: 'Dobry Plan Finansowy' }), 'DP')
    assert.equal(brandInitials({ expertName: 'Anna Nowak' }), 'AN')
  })
})
