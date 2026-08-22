import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TextReader,
  Uint8ArrayWriter,
  ZipWriter,
} from '@zip.js/zip.js'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  extractMailAgentAttachmentText,
  MAIL_AGENT_ATTACHMENT_MAX_ARCHIVE_ENTRIES,
  MAIL_AGENT_ATTACHMENT_MAX_INPUT_BYTES,
  MAIL_AGENT_ATTACHMENT_MAX_TEXT_CHARACTERS,
  selectMailAgentAttachmentExcerpts,
  type MailAgentAttachmentTextResult,
} from '../server/utils/mail-agent-attachment-text.ts'

async function officeArchive(
  entries: ReadonlyArray<readonly [name: string, text: string]>,
  options: { password?: string } = {},
): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    level: 6,
    useWebWorkers: false,
    ...(options.password
      ? { password: options.password, encryptionStrength: 3 as const, zipCrypto: false }
      : {}),
  })
  for (const [name, text] of entries) {
    await writer.add(name, new TextReader(text))
  }
  return writer.close()
}

test('extracts bounded UTF-8 plain text and visible HTML without active content', async () => {
  const plain = await extractMailAgentAttachmentText({
    bytes: new TextEncoder().encode('Klient: Anna Kowalska\r\nDochód: 12 500 PLN'),
    fileName: 'dane.txt',
    mimeType: 'text/plain; charset=utf-8',
  })
  assert.deepEqual(plain, {
    status: 'ok',
    kind: 'plain_text',
    text: 'Klient: Anna Kowalska\nDochód: 12 500 PLN',
    truncated: false,
  })

  const html = await extractMailAgentAttachmentText({
    bytes: new TextEncoder().encode(`
      <html><body><h1>Decyzja pozytywna</h1>
      <p>Kwota: 500&nbsp;000 PLN</p>
      <script>stealSecrets()</script><style>.hidden { display: none }</style>
      </body></html>
    `),
    fileName: 'decyzja.html',
    mimeType: 'text/html',
  })
  assert.equal(html.status, 'ok')
  assert.equal(html.kind, 'html')
  assert.match(html.text, /Decyzja pozytywna/u)
  assert.match(html.text, /500 000 PLN/u)
  assert.doesNotMatch(html.text, /stealSecrets|display:\s*none/u)
})

test('extracts text from a textual PDF through pdfjs', async () => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([500, 700])
  page.drawText('Credit decision: positive', { x: 40, y: 640, size: 14, font })
  page.drawText('Monthly income: 12500 PLN', { x: 40, y: 610, size: 12, font })

  const result = await extractMailAgentAttachmentText({
    bytes: await pdf.save(),
    fileName: 'decision.pdf',
    mimeType: 'application/pdf',
  })

  assert.equal(result.status, 'ok')
  assert.equal(result.kind, 'pdf')
  assert.equal(result.pageCount, 1)
  assert.equal(result.truncated, false)
  assert.match(result.text, /Credit decision: positive/u)
  assert.match(result.text, /Monthly income: 12500 PLN/u)
})

test('extracts only selected DOCX XML entries', async () => {
  const bytes = await officeArchive([
    ['[Content_Types].xml', '<Types/>'],
    ['word/document.xml', `
      <w:document xmlns:w="urn:w"><w:body>
        <w:p><w:r><w:t>Klient: Anna Kowalska</w:t></w:r></w:p>
        <w:p><w:r><w:t>Dochód miesięczny: 12 500 PLN</w:t></w:r></w:p>
      </w:body></w:document>
    `],
    ['word/header1.xml', '<w:hdr xmlns:w="urn:w"><w:p><w:r><w:t>Bank Przykładowy</w:t></w:r></w:p></w:hdr>'],
    ['word/media/not-parsed.xml', '<secret>This entry must not be read</secret>'],
  ])

  const result = await extractMailAgentAttachmentText({
    bytes,
    fileName: 'wniosek.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })

  assert.equal(result.status, 'ok')
  assert.equal(result.kind, 'docx')
  assert.match(result.text, /Klient: Anna Kowalska/u)
  assert.match(result.text, /Dochód miesięczny: 12 500 PLN/u)
  assert.match(result.text, /Bank Przykładowy/u)
  assert.doesNotMatch(result.text, /must not be read/u)
})

test('extracts shared strings, values, formulas and cell references from XLSX', async () => {
  const bytes = await officeArchive([
    ['xl/sharedStrings.xml', `
      <sst><si><t>Klient</t></si><si><t>Anna Kowalska</t></si><si><t>Dochód</t></si></sst>
    `],
    ['xl/worksheets/sheet1.xml', `
      <worksheet><sheetData><row>
        <c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>
        <c r="A2" t="s"><v>2</v></c><c r="B2"><f>SUM(12000,500)</f><v>12500</v></c>
      </row></sheetData></worksheet>
    `],
    ['xl/styles.xml', '<styleSheet><malicious>ignored</malicious></styleSheet>'],
  ])

  const result = await extractMailAgentAttachmentText({
    bytes,
    fileName: 'analiza.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  assert.equal(result.status, 'ok')
  assert.equal(result.kind, 'xlsx')
  assert.match(result.text, /A1: Klient/u)
  assert.match(result.text, /B1: Anna Kowalska/u)
  assert.match(result.text, /A2: Dochód/u)
  assert.match(result.text, /B2: 12500 \(formula: SUM\(12000,500\)\)/u)
  assert.doesNotMatch(result.text, /malicious|ignored/u)
})

test('rejects encrypted OOXML and archives exceeding the entry limit without leaking parser errors', async () => {
  const encrypted = await officeArchive([
    ['word/document.xml', '<w:document xmlns:w="urn:w"><w:p><w:t>Tajne</w:t></w:p></w:document>'],
  ], { password: 'secret-password' })
  const encryptedResult = await extractMailAgentAttachmentText({
    bytes: encrypted,
    fileName: 'tajne.docx',
    mimeType: 'application/octet-stream',
  })
  assert.deepEqual(encryptedResult, {
    status: 'unsupported',
    kind: 'docx',
    text: '',
    truncated: false,
    reason: 'encrypted_document',
  })

  const entries: Array<readonly [string, string]> = [
    ['word/document.xml', '<w:document xmlns:w="urn:w"><w:p><w:t>Tekst</w:t></w:p></w:document>'],
  ]
  for (let index = 0; index < MAIL_AGENT_ATTACHMENT_MAX_ARCHIVE_ENTRIES; index += 1) {
    entries.push([`custom-${index}.bin`, 'x'])
  }
  const tooManyEntries = await officeArchive(entries)
  const entryLimitResult = await extractMailAgentAttachmentText({
    bytes: tooManyEntries,
    fileName: 'bomb.docx',
    mimeType: 'application/octet-stream',
  })
  assert.equal(entryLimitResult.status, 'unsupported')
  assert.equal(entryLimitResult.kind, 'docx')
  assert.equal(entryLimitResult.reason, 'archive_entry_limit')
  assert.equal(entryLimitResult.text, '')
})

test('returns controlled unsupported or no-text results for unsafe and unreadable formats', async () => {
  const legacy = await extractMailAgentAttachmentText({
    bytes: Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    fileName: 'stary.xls',
    mimeType: 'application/vnd.ms-excel',
  })
  assert.equal(legacy.status, 'unsupported')
  assert.equal(legacy.kind, 'legacy_office')
  assert.equal(legacy.reason, 'legacy_office_not_supported')

  const image = await extractMailAgentAttachmentText({
    bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    fileName: 'skan.png',
    mimeType: 'image/png',
  })
  assert.equal(image.status, 'unsupported')
  assert.equal(image.kind, 'image')
  assert.equal(image.reason, 'image_requires_ocr')

  const archive = await officeArchive([['note.txt', 'hello']])
  const genericZip = await extractMailAgentAttachmentText({
    bytes: archive,
    fileName: 'files.zip',
    mimeType: 'application/zip',
  })
  assert.equal(genericZip.status, 'unsupported')
  assert.equal(genericZip.kind, 'archive')
  assert.equal(genericZip.reason, 'archive_not_supported')

  const corruptDocx = await extractMailAgentAttachmentText({
    bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
    fileName: 'corrupt.docx',
    mimeType: 'application/octet-stream',
  })
  assert.equal(corruptDocx.status, 'no_text')
  assert.equal(corruptDocx.kind, 'docx')
  assert.equal(corruptDocx.reason, 'unreadable_document')

  const tooLarge = await extractMailAgentAttachmentText({
    bytes: new Uint8Array(MAIL_AGENT_ATTACHMENT_MAX_INPUT_BYTES + 1),
    fileName: 'large.txt',
    mimeType: 'text/plain',
  })
  assert.equal(tooLarge.status, 'unsupported')
  assert.equal(tooLarge.reason, 'input_too_large')
})

test('caps extracted text and selects bounded question-relevant excerpts', async () => {
  const longText = `Początek dokumentu.\n${'Dane ogólne. '.repeat(20_000)}`
  const capped = await extractMailAgentAttachmentText({
    bytes: new TextEncoder().encode(longText),
    fileName: 'long.md',
    mimeType: 'text/markdown',
  })
  assert.equal(capped.status, 'ok')
  assert.equal(capped.kind, 'markdown')
  assert.equal(capped.text.length, MAIL_AGENT_ATTACHMENT_MAX_TEXT_CHARACTERS)
  assert.equal(capped.truncated, true)
  assert.equal(capped.reason, 'text_limit')

  const extraction: MailAgentAttachmentTextResult = {
    status: 'ok',
    kind: 'plain_text',
    text: [
      `Sekcja techniczna. ${'To są nieistotne informacje organizacyjne. '.repeat(18)}`,
      `Finanse klienta. Miesięczne wynagrodzenie netto wynosi 12 500 PLN. ${'Dochód jest stabilny. '.repeat(14)}`,
      `Pozostałe informacje. ${'Historia korespondencji bez kwot. '.repeat(18)}`,
    ].join('\n\n'),
    truncated: false,
  }
  const excerpts = selectMailAgentAttachmentExcerpts(
    extraction,
    'Jakie jest miesięczne wynagrodzenie klienta?',
    { maxExcerpts: 2, maxExcerptCharacters: 320, maxTotalCharacters: 500 },
  )
  assert.ok(excerpts.length >= 1 && excerpts.length <= 2)
  assert.match(excerpts[0]?.text ?? '', /12 500 PLN/u)
  assert.ok(excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0) <= 500)
  assert.ok(excerpts.every(excerpt => excerpt.end > excerpt.start && excerpt.score > 0))
  assert.deepEqual(selectMailAgentAttachmentExcerpts({ ...extraction, status: 'no_text', text: '' }), [])
})
