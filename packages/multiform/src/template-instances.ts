import type {
  DocumentTemplate,
  FieldCondition,
  TemplateBinding,
} from './types.ts'

function indexedPrefix(collection: string, index: number) {
  return `${collection}.${index}.`
}

function remapKey(
  key: string,
  collection: string,
  templateIndex: number,
  instanceIndex: number,
) {
  const prefix = indexedPrefix(collection, templateIndex)
  return key.startsWith(prefix)
    ? `${indexedPrefix(collection, instanceIndex)}${key.slice(prefix.length)}`
    : key
}

function remapCondition(
  condition: FieldCondition | undefined,
  collection: string,
  templateIndex: number,
  instanceIndex: number,
): FieldCondition | undefined {
  if (!condition) return undefined
  return {
    ...condition,
    canonicalKey: remapKey(
      condition.canonicalKey,
      collection,
      templateIndex,
      instanceIndex,
    ),
  }
}

export function instantiateTemplate(
  template: DocumentTemplate,
  instanceIndex: number,
): DocumentTemplate {
  const repeatFor = template.repeatFor
  if (!repeatFor) {
    if (instanceIndex !== 0) {
      throw new Error(`Template ${template.id} nie jest formularzem powtarzanym.`)
    }
    return template
  }
  if (
    !Number.isSafeInteger(instanceIndex)
    || instanceIndex < 0
    || instanceIndex >= repeatFor.maxInstances
  ) {
    throw new Error(`Indeks instancji template'u ${template.id} jest nieprawidłowy.`)
  }

  const bindings: TemplateBinding[] = template.bindings.map(binding => ({
    ...binding,
    canonicalKey: remapKey(
      binding.canonicalKey,
      repeatFor.collection,
      repeatFor.templateIndex,
      instanceIndex,
    ),
    ...(binding.valueFrom
      ? {
          valueFrom: binding.valueFrom.map(key => remapKey(
            key,
            repeatFor.collection,
            repeatFor.templateIndex,
            instanceIndex,
          )),
        }
      : {}),
    ...(binding.condition
      ? {
          condition: remapCondition(
            binding.condition,
            repeatFor.collection,
            repeatFor.templateIndex,
            instanceIndex,
          ),
        }
      : {}),
  }))

  return {
    ...template,
    label: `${template.label} - ${repeatFor.itemLabel} ${instanceIndex + 1}`,
    bindings,
    includeWhen: remapCondition(
      template.includeWhen,
      repeatFor.collection,
      repeatFor.templateIndex,
      instanceIndex,
    ),
    requiredCanonicalKeys: template.requiredCanonicalKeys?.map(key => remapKey(
      key,
      repeatFor.collection,
      repeatFor.templateIndex,
      instanceIndex,
    )),
    repeatFor: undefined,
  }
}

export function templateMatchesValues(
  template: DocumentTemplate,
  values: Readonly<Record<string, unknown>>,
) {
  if (!template.includeWhen) return true
  const actual = values[template.includeWhen.canonicalKey]
  if (actual === undefined || actual === null) return false
  const expected = Array.isArray(template.includeWhen.equals)
    ? template.includeWhen.equals
    : [template.includeWhen.equals]
  return expected.includes(String(actual))
}

export function templateInstanceIndexes(
  template: DocumentTemplate,
  collectionCounts: Readonly<Record<string, number>>,
) {
  if (!template.repeatFor) return [0]
  const count = collectionCounts[template.repeatFor.collection] ?? 0
  if (!Number.isSafeInteger(count) || count < 0 || count > template.repeatFor.maxInstances) {
    throw new Error(`Liczba instancji template'u ${template.id} jest nieprawidłowa.`)
  }
  return Array.from({ length: count }, (_, index) => index)
}
