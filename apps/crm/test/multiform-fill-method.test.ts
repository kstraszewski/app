import assert from 'node:assert/strict'
import test from 'node:test'

import {
  multiformFillMethodIsSupported,
  multiformFillMethodPresentation,
} from '../app/utils/multiform-fill-method.ts'

test('labels every supported PDF completion method', () => {
  assert.deepEqual(multiformFillMethodPresentation({ kind: 'pdf_acroform' }), {
    label: 'Interaktywny PDF',
    availability: 'supported',
  })
  assert.deepEqual(multiformFillMethodPresentation({ kind: 'pdf_overlay' }), {
    label: 'Statyczny PDF',
    availability: 'supported',
  })
  assert.deepEqual(multiformFillMethodPresentation({ kind: 'pdf_hybrid' }), {
    label: 'Hybrydowy PDF',
    availability: 'supported',
  })
})

test('reserves web form and API labels without claiming renderer support', () => {
  for (const [kind, label] of [
    ['web_form', 'Formularz internetowy'],
    ['api', 'Integracja API'],
  ] as const) {
    assert.deepEqual(multiformFillMethodPresentation({ kind }), {
      label,
      availability: 'not_supported',
    })
    assert.equal(multiformFillMethodIsSupported({ kind }), false)
  }

  assert.equal(multiformFillMethodIsSupported(undefined), false)
})
