import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { contrastingTextColor } from '../app/utils/color-contrast.ts'

describe('brand color contrast', () => {
  it('chooses whichever of black and white has the stronger WCAG contrast', () => {
    assert.equal(contrastingTextColor('#FF6200'), '#000000')
    assert.equal(contrastingTextColor('#EA0A0A'), '#FFFFFF')
    assert.equal(contrastingTextColor('#FF2038'), '#000000')
    assert.equal(contrastingTextColor('#2870ED'), '#000000')
    assert.equal(contrastingTextColor('#D71921'), '#FFFFFF')
  })

  it('rejects unsupported color formats instead of guessing', () => {
    assert.equal(contrastingTextColor('rgb(255, 98, 0)'), null)
    assert.equal(contrastingTextColor('#FFF'), null)
  })
})
