// Symbol keys survive internal object spreads but are ignored by JSON.stringify.
// Provider adapters can therefore preserve the draft state for agent-side
// filtering without adding a field to the public mail or EVE DTOs.
const draftState = Symbol('openexpert.mail.draft-state')

export function withMailMessageDraftState<T extends object>(
  message: T,
  draft: boolean,
): T {
  if (!draft) return message
  Object.defineProperty(message, draftState, {
    configurable: false,
    enumerable: true,
    value: true,
    writable: false,
  })
  return message
}

export function mailMessageIsDraft(message: object): boolean {
  return (message as Record<symbol, unknown>)[draftState] === true
}
