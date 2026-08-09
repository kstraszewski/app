import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveCrmApplicantProfile } from '../server/utils/multiform-applicants.ts'

test('uses the primary person name and PESEL instead of the client relationship label', () => {
  const profile = resolveCrmApplicantProfile(
    { display_name: 'Aleksandra Zielińska — E2E singiel' },
    [{
      client_id: 'client-1',
      display_name: 'Aleksandra Zielińska',
      pesel: '85821435745',
      email: 'aleksandra@example.local',
      phone: '+48 500 600 700',
      date_of_birth: '1985-02-14',
      role: 'primary',
    }],
    'Główny wnioskodawca 1',
  )

  assert.deepEqual(profile, {
    label: 'Aleksandra Zielińska',
    pesel: '85821435745',
    email: 'aleksandra@example.local',
    phone: '+48 500 600 700',
    birthDate: '1985-02-14',
  })
})

test('falls back to the client label when no person record is available', () => {
  assert.deepEqual(
    resolveCrmApplicantProfile(
      { display_name: 'Jan Kowalski' },
      [],
      'Wnioskodawca 1',
    ),
    {
      label: 'Jan Kowalski',
      pesel: null,
      email: null,
      phone: null,
      birthDate: null,
    },
  )
})
