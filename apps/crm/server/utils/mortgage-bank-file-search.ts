export function normalizeMortgageBankFileSearchText(value: unknown) {
  return String(value ?? '')
    .toLocaleLowerCase('pl-PL')
    .replace(/[ąćęłńóśźż]/gu, character => ({
      ą: 'a',
      ć: 'c',
      ę: 'e',
      ł: 'l',
      ń: 'n',
      ó: 'o',
      ś: 's',
      ź: 'z',
      ż: 'z',
    })[character] ?? character)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
}

function wordsAreClose(left: string, right: string) {
  if (left === right) return true
  if (left.length <= 3 || right.length <= 3 || Math.abs(left.length - right.length) > 1) {
    return false
  }

  let leftIndex = 0
  let rightIndex = 0
  let edits = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1
      rightIndex += 1
      continue
    }
    edits += 1
    if (edits > 1) return false
    if (left.length > right.length) leftIndex += 1
    else if (right.length > left.length) rightIndex += 1
    else {
      leftIndex += 1
      rightIndex += 1
    }
  }
  return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1
}

export function mortgageBankFileSearchMatch(query: string, values: unknown[]) {
  const queryWords = normalizeMortgageBankFileSearchText(query).split(/\s+/u).filter(Boolean)
  if (!queryWords.length) return true
  const candidateWords = normalizeMortgageBankFileSearchText(values.filter(Boolean).join(' '))
    .split(/\s+/u)
    .filter(Boolean)

  return queryWords.every(queryWord => (
    candidateWords.some(candidateWord => (
      (queryWord.length >= 3 && candidateWord.startsWith(queryWord))
      || wordsAreClose(queryWord, candidateWord)
    ))
  ))
}

export function cleanMortgageBankFileSearchSnippet(value: unknown) {
  return String(value ?? '')
    .replace(/,StopSel=/giu, '')
    .replace(/<\/?(?:b|mark)>/giu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}
