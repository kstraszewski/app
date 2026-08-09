export interface MultiformCollectionBounds {
  minItems: number
  maxItems: number
}

interface MultiformCollectionFieldLike {
  collection?: {
    key: string
    index: number
  }
}

export interface MultiformCollectionState {
  count: number
  activeIndex: number | null
  canAdd: boolean
  canRemove: boolean
}

export function supportedCollectionItemCount(
  collectionKey: string,
  maxItems: number,
  fields: readonly MultiformCollectionFieldLike[],
) {
  const indexes = new Set(fields.flatMap(field => (
    field.collection?.key === collectionKey ? [field.collection.index] : []
  )))
  let supported = 0
  while (indexes.has(supported)) supported += 1
  return Math.min(Math.max(0, maxItems), supported)
}

export function normalizeCollectionCount(
  count: number | undefined,
  bounds: MultiformCollectionBounds,
) {
  const minimum = Math.max(0, Math.min(bounds.minItems, bounds.maxItems))
  const requested = Number.isInteger(count) ? Number(count) : minimum
  return Math.max(minimum, Math.min(bounds.maxItems, requested))
}

export function normalizeCollectionActiveIndex(
  activeIndex: string | number | null | undefined,
  count: number,
) {
  if (count <= 0) return null
  const parsed = Number(activeIndex)
  if (!Number.isInteger(parsed)) return 0
  return Math.max(0, Math.min(count - 1, parsed))
}

export function collectionState(
  count: number | undefined,
  activeIndex: string | number | null | undefined,
  bounds: MultiformCollectionBounds,
): MultiformCollectionState {
  const normalizedCount = normalizeCollectionCount(count, bounds)
  return {
    count: normalizedCount,
    activeIndex: normalizeCollectionActiveIndex(activeIndex, normalizedCount),
    canAdd: normalizedCount < bounds.maxItems,
    canRemove: normalizedCount > bounds.minItems,
  }
}

export function changeCollectionCount(
  state: MultiformCollectionState,
  bounds: MultiformCollectionBounds,
  direction: 'add' | 'remove',
): MultiformCollectionState {
  const nextCount = direction === 'add'
    ? Math.min(bounds.maxItems, state.count + 1)
    : Math.max(bounds.minItems, state.count - 1)
  const activeIndex = direction === 'add' && nextCount > state.count
    ? nextCount - 1
    : normalizeCollectionActiveIndex(state.activeIndex, nextCount)

  return collectionState(nextCount, activeIndex, bounds)
}
