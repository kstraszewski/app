import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createCustomTheme,
  getContrastRatio,
  normalizeCustomTheme,
  personalizationPresets,
  themeToCssVariables,
} from '../app/utils/personalization-theme.ts'

test('neutral presets expose distinct palettes and font choices', () => {
  const [ocean, ember, plum] = personalizationPresets

  assert.equal(ocean?.id, 'ocean')
  assert.equal(ocean?.colors.primary, '#2563EB')
  assert.equal(ocean?.fonts.body, 'dm-sans')
  assert.equal(ember?.id, 'ember')
  assert.equal(ember?.colors.primary, '#C2410C')
  assert.equal(ember?.fonts.body, 'roboto')
  assert.equal(plum?.id, 'plum')
  assert.equal(plum?.colors.primary, '#9B0050')
  assert.equal(plum?.colors.accent, '#EF7F1A')
  assert.equal(plum?.colors.text, '#111928')
  assert.equal(plum?.fonts.display, 'manrope')
  assert.equal(plum?.fonts.body, 'manrope')
})

test('custom theme clones a preset without mutating the source', () => {
  const source = personalizationPresets[0]!
  const custom = createCustomTheme(source)

  custom.colors.primary = '#000000'

  assert.equal(custom.id, 'custom')
  assert.equal(source.colors.primary, '#2563EB')
})

test('stored custom values are normalized and invalid values fall back safely', () => {
  const fallback = personalizationPresets[1]!
  const normalized = normalizeCustomTheme({
    colors: {
      primary: '#123456',
      text: 'not-a-color',
    },
    fonts: {
      display: 'georgia',
      body: 'unknown-font',
    },
    radius: 200,
  }, fallback)

  assert.equal(normalized.colors.primary, '#123456')
  assert.equal(normalized.colors.text, fallback.colors.text)
  assert.equal(normalized.fonts.display, 'georgia')
  assert.equal(normalized.fonts.body, fallback.fonts.body)
  assert.equal(normalized.radius, 24)
})

test('theme CSS variables include palette, derived soft colors, fonts and radius', () => {
  const variables = themeToCssVariables(personalizationPresets[2]!)

  assert.equal(variables['--theme-primary'], '#9B0050')
  assert.equal(variables['--theme-primary-soft'], 'rgba(155, 0, 80, 0.09)')
  assert.match(variables['--theme-font-display'] ?? '', /Manrope/)
  assert.equal(variables['--theme-radius'], '8px')
})

test('contrast ratio matches WCAG reference values', () => {
  assert.equal(getContrastRatio('#000000', '#FFFFFF'), 21)
  assert.ok(getContrastRatio('#3F2A22', '#FFFFFF') > 9)
  assert.equal(getContrastRatio('invalid', '#FFFFFF'), 1)
})
