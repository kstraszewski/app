import assert from 'node:assert/strict'
import test from 'node:test'
import { forumHighlightedSegments } from '../app/utils/forum-highlight.ts'

test('highlights a query at the beginning without highlighting the remaining text', () => {
  assert.deepEqual(
    forumHighlightedSegments(
      'Klient prowadzi działalność od 18 miesięcy.',
      'klient',
    ),
    [
      { text: 'Klient', highlighted: true },
      { text: ' prowadzi działalność od 18 miesięcy.', highlighted: false },
    ],
  )
})

test('highlights a query in the middle of a title', () => {
  assert.deepEqual(
    forumHighlightedSegments(
      'Jak odpowiedzieć klientowi, gdy analiza się przedłuża?',
      'klient',
    ),
    [
      { text: 'Jak odpowiedzieć ', highlighted: false },
      { text: 'klient', highlighted: true },
      { text: 'owi, gdy analiza się przedłuża?', highlighted: false },
    ],
  )
})

test('ignores short and punctuation-only search tokens', () => {
  assert.deepEqual(
    forumHighlightedSegments('Klient czeka na odpowiedź.', 'na ?'),
    [{ text: 'Klient czeka na odpowiedź.', highlighted: false }],
  )
})
