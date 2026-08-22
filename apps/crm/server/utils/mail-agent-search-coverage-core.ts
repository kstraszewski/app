export const MICROSOFT_MAIL_SEARCH_RESULT_LIMIT = 1_000

export function microsoftMailSearchResultLimitReached(input: {
  usesMicrosoftSearch: boolean
  processedMessageCount: number
  pageMessageCount: number | undefined
  hasNextPage: boolean
}): boolean {
  if (!input.usesMicrosoftSearch || input.hasNextPage) return false
  if (
    !Number.isSafeInteger(input.processedMessageCount)
    || input.processedMessageCount < 0
    || !Number.isSafeInteger(input.pageMessageCount)
    || Number(input.pageMessageCount) < 0
  ) return true
  return input.processedMessageCount + Number(input.pageMessageCount)
    >= MICROSOFT_MAIL_SEARCH_RESULT_LIMIT
}
