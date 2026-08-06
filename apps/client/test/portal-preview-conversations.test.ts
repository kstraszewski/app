import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createPortalPreviewMessages } from '../app/composables/usePortalPreviewConversations.ts'

describe('client portal preview conversations', () => {
  it('creates a distinct history for every preview case', () => {
    const purchase = createPortalPreviewMessages('case-preview-warszewo')
    const refinance = createPortalPreviewMessages('case-preview-refinance')

    assert.notDeepEqual(
      purchase.map(message => message.body),
      refinance.map(message => message.body),
    )
    assert.equal(purchase.every(message => message.conversationId.endsWith('case-preview-warszewo')), true)
    assert.equal(refinance.every(message => message.conversationId.endsWith('case-preview-refinance')), true)
    assert.equal(refinance.at(-1)?.body, 'Tak. Zestawienie finalnych ofert będzie gotowe jutro rano.')
  })

  it('returns fresh seed arrays instead of sharing mutable messages', () => {
    const first = createPortalPreviewMessages('case-preview-warszewo')
    const second = createPortalPreviewMessages('case-preview-warszewo')

    first.pop()

    assert.equal(first.length, 2)
    assert.equal(second.length, 3)
  })
})
