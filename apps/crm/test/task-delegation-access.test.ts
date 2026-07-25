import assert from 'node:assert/strict'
import test from 'node:test'
import {
  caseTaskDelegationAccessScopeIsRequired,
  normalizeCaseTaskDelegationAccessScope,
} from '../app/utils/task-delegation-access.ts'

test('appointment access always includes client identity and contact data', () => {
  assert.deepEqual(
    normalizeCaseTaskDelegationAccessScope(['documents'], true),
    ['case_summary', 'client_identity', 'client_contact', 'documents'],
  )
})

test('deadline access keeps client data optional', () => {
  assert.deepEqual(
    normalizeCaseTaskDelegationAccessScope(['documents'], false),
    ['case_summary', 'documents'],
  )
  assert.deepEqual(
    normalizeCaseTaskDelegationAccessScope(['client_contact'], false),
    ['case_summary', 'client_contact'],
  )
})

test('required access follows the selected scheduling mode', () => {
  assert.equal(caseTaskDelegationAccessScopeIsRequired('case_summary', false), true)
  assert.equal(caseTaskDelegationAccessScopeIsRequired('client_identity', false), false)
  assert.equal(caseTaskDelegationAccessScopeIsRequired('client_contact', false), false)
  assert.equal(caseTaskDelegationAccessScopeIsRequired('client_identity', true), true)
  assert.equal(caseTaskDelegationAccessScopeIsRequired('client_contact', true), true)
  assert.equal(caseTaskDelegationAccessScopeIsRequired('documents', true), false)
})
