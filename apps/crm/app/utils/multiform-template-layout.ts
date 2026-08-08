import type { DocumentTemplate } from '@openexpert/multiform'

function layoutContract(binding: DocumentTemplate['bindings'][number]) {
  const contract = structuredClone(binding)
  delete contract.reviewStatus
  if (contract.target.kind === 'overlay' && contract.target.rendererVersion === 2) {
    contract.target.page = 0
    contract.target.box = { x: 0, y: 0, width: 0, height: 0 }
    contract.target.appearance = {
      kind: 'mark',
      role: 'checkbox',
      glyph: 'x',
      color: { space: 'gray', value: 0 },
      opacity: 1,
      insetPt: 0,
      strokeWidthPt: 0,
    }
  }
  else if (contract.target.kind === 'acroform') {
    delete contract.target.placementOverrides
    delete contract.target.appearance
  }
  return JSON.stringify(contract)
}

export function approveTemplateLayoutRevision(
  active: DocumentTemplate,
  submitted: DocumentTemplate,
) {
  if (active.coverage.status !== 'complete') {
    throw new Error('Aktywny szablon nie ma kompletnego, zatwierdzonego mapowania pól.')
  }
  if (submitted.bindings.length !== active.bindings.length) {
    throw new Error('W szybkim podglądzie można zmieniać położenie i wygląd istniejących pól, ale nie ich liczbę.')
  }

  const next = structuredClone(active)
  for (const [index, submittedBinding] of submitted.bindings.entries()) {
    const activeBinding = active.bindings[index]
    const nextBinding = next.bindings[index]
    if (
      !activeBinding
      || !nextBinding
      || layoutContract(submittedBinding) !== layoutContract(activeBinding)
    ) {
      throw new Error('W szybkim podglądzie zmieniono coś poza położeniem lub wyglądem pola. Użyj pełnego Studio szablonu.')
    }

    if (
      submittedBinding.target.kind === 'overlay'
      && submittedBinding.target.rendererVersion === 2
      && nextBinding.target.kind === 'overlay'
      && nextBinding.target.rendererVersion === 2
    ) {
      nextBinding.target.page = submittedBinding.target.page
      nextBinding.target.box = structuredClone(submittedBinding.target.box)
      nextBinding.target.appearance = structuredClone(submittedBinding.target.appearance)
    }
    else if (
      submittedBinding.target.kind === 'acroform'
      && nextBinding.target.kind === 'acroform'
    ) {
      nextBinding.target.placementOverrides = submittedBinding.target.placementOverrides
        ? structuredClone(submittedBinding.target.placementOverrides)
        : undefined
      nextBinding.target.appearance = submittedBinding.target.appearance
        ? structuredClone(submittedBinding.target.appearance)
        : undefined
    }
    nextBinding.reviewStatus = 'ready'
  }

  return next
}
