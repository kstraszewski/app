import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertExperimentKnowledgeSource,
  experimentKnowledgeHtmlToText,
  experimentKnowledgePlainText,
  splitExperimentKnowledgeText,
} from '../app/utils/experiment-knowledge.ts'

describe('experiment knowledge content pipeline', () => {
  it('extracts visible HTML text without indexing code or styles', () => {
    const text = experimentKnowledgeHtmlToText(`
      <style>.secret { content: "not searchable" }</style>
      <main>
        <h1>Plan &amp; dokumenty</h1>
        <p>Wkład własny&nbsp;20%.</p>
        <script>window.privateToken = 'not searchable'</script>
      </main>
    `)

    assert.equal(text, 'Plan & dokumenty\n\nWkład własny 20%.')
    assert.doesNotMatch(text, /secret|privateToken|searchable/u)
  })

  it('normalizes text documents before indexing', () => {
    assert.equal(experimentKnowledgePlainText({
      kind: 'text',
      title: 'Dokument',
      textContent: '  Pierwszy   akapit\r\n\r\n\r\nDrugi akapit  ',
      htmlContent: null,
      cssContent: null,
      javascriptContent: null,
    }), 'Pierwszy akapit\n\nDrugi akapit')
  })

  it('creates ordered, bounded overlapping chunks', () => {
    const source = Array.from({ length: 1_200 }, (_, index) => `Zdanie numer ${index}.`).join(' ')
    const chunks = splitExperimentKnowledgeText(source)

    assert.ok(chunks.length > 1)
    assert.deepEqual(chunks.map(chunk => chunk.chunkIndex), chunks.map((_, index) => index))
    assert.ok(chunks.every(chunk => chunk.content.length <= 5_500))
    assert.ok(chunks.every(chunk => chunk.tokenCount >= 1))
    assert.ok(chunks[0]!.content.slice(-150).split(' ').some(word => chunks[1]!.content.includes(word)))
  })

  it('detects dynamic projects without searchable HTML text', () => {
    const source = {
      kind: 'dynamic_html' as const,
      title: 'Pusty projekt',
      textContent: null,
      htmlContent: '<script>document.body.textContent = "runtime only"</script>',
      cssContent: '',
      javascriptContent: '',
    }
    assertExperimentKnowledgeSource(source)
    assert.equal(experimentKnowledgePlainText(source), '')
  })
})
