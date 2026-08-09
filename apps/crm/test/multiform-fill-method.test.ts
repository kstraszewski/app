import assert from 'node:assert/strict'
import test from 'node:test'

import {
  multiformFillMethodIsSupported,
  multiformFillMethodPresentation,
} from '../app/utils/multiform-fill-method.ts'

test('labels every supported document completion method', () => {
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
  assert.deepEqual(multiformFillMethodPresentation({ kind: 'pdf_manual' }), {
    label: 'PDF do uzupełnienia ręcznie',
    availability: 'supported',
  })
  assert.deepEqual(multiformFillMethodPresentation({ kind: 'pdf_readonly' }), {
    label: 'Dokument informacyjny PDF',
    availability: 'supported',
  })
  assert.deepEqual(multiformFillMethodPresentation({ kind: 'xlsx_native' }), {
    label: 'Edytowalny arkusz XLSX',
    availability: 'supported',
  })
  assert.deepEqual(multiformFillMethodPresentation({ kind: 'xlsx_manual' }), {
    label: 'Arkusz XLSX do uzupełnienia ręcznie',
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
