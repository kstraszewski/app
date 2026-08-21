import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  renderClientLegalDocumentsEmail,
  renderMultiformPackageEmail,
  renderOpenExpertMockBankEmail,
} from '../server/utils/system-email-content.ts'
import type { TransactionalEmailRenderer } from '../server/utils/transactional-email-content.ts'

function rendererLog() {
  const calls: Array<{ component: string, props: Record<string, unknown>, plainText: boolean }> = []
  const renderer: TransactionalEmailRenderer = async (component, props, options) => {
    calls.push({ component, props, plainText: options?.plainText === true })
    return { html: options?.plainText ? 'plain text' : '<!DOCTYPE html><html></html>', subject: String(props.subject) }
  }
  return { calls, renderer }
}

test('legal-document email uses the shared Vue renderer and keeps its regulatory context', async () => {
  const { calls, renderer } = rendererLog()
  const email = await renderClientLegalDocumentsEmail({ organizationName: 'Dobry Kredyt' }, renderer)

  assert.equal(email.subject, 'Dokumenty OFI i RODO – Dobry Kredyt')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(call => call.component), ['TransactionalEmail', 'TransactionalEmail'])
  assert.equal(calls[0]?.props.notice && (calls[0].props.notice as { title: string }).title, 'Informacja ustawowa')
})

test('multiform email describes the secured attachment without disclosing the PESEL', async () => {
  const { calls, renderer } = rendererLog()
  await renderMultiformPackageEmail({ recipientName: 'Jan <Kowalski>' }, renderer)

  const props = calls[0]?.props
  assert.equal(props?.title, 'Paczka dokumentów jest gotowa')
  assert.match(String((props?.notice as { text: string }).text), /PESEL/u)
  assert.doesNotMatch(String((props?.notice as { text: string }).text), /\d{11}/u)
})

test('mock bank email makes the DEMO status and encrypted attachment explicit', async () => {
  const { calls, renderer } = rendererLog()
  const email = await renderOpenExpertMockBankEmail({
    kind: 'credit_decision',
    applicationNumber: 'OEB-20260821-123456',
    applicantNames: ['Anna Kowalska'],
    issueDate: '2026-08-21',
    validUntil: '2026-09-20',
    decisionOutcome: 'positive',
    archiveName: 'decyzja.zip',
  }, renderer)

  assert.match(email.subject, /^\[DEMO\]/u)
  assert.equal((calls[0]?.props.status as { label: string }).label, 'DECYZJA POZYTYWNA')
  assert.match(String((calls[0]?.props.notice as { text: string }).text), /archiwum ZIP/u)
})

test('shared CRM template has the email accessibility baseline', () => {
  const source = readFileSync(new URL('../app/emails/TransactionalEmail.vue', import.meta.url), 'utf8')
  assert.match(source, /<EHtml lang="pl" dir="ltr">/u)
  assert.match(source, /<EPreview id="__vue-email-preview">/u)
  assert.match(source, /<EHeading/u)
  assert.doesNotMatch(source, /v-html/u)
  for (const [table] of source.matchAll(/<table\b[^>]*>/gu)) assert.match(table, /role="presentation"/u)
})
