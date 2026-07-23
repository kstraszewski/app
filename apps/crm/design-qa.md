# Design QA — Organization Design System

final result: passed

## Scope

- Route: `/org/openexpert-local-04b35ead/settings/design`
- Source visual: `/Users/konradstraszewski/.codex/generated_images/019f8b0a-ee22-78c1-a094-5991403e41c6/exec-5571f5ad-1547-4fd9-aa01-a1807dc1afcc.png`
- Implementation: `app/pages/org/[organizationSlug]/settings/design.vue`
- Source and comparison viewport: `1487 × 1058`, device pixel ratio `1`
- Final browser handoff viewport: browser default (`1280 × 720` during verification)

## Evidence

- Source + first implementation comparison: `/private/tmp/openexpert-design-qa/comparison-pass-1.png`
- First implementation screenshot: `/private/tmp/openexpert-design-qa/implementation-pass-1.png`
- Source + corrected implementation comparison: `/private/tmp/openexpert-design-qa/comparison-pass-2.png`
- Source + matched dirty-state comparison: `/private/tmp/openexpert-design-qa/comparison-matched-state.png`
- Corrected implementation screenshot: `/private/tmp/openexpert-design-qa/implementation-pass-2.png`
- Responsive screenshot at `768 × 900`: `/private/tmp/openexpert-design-qa/responsive-768x900.png`
- Final clean-state screenshot: `/private/tmp/openexpert-design-qa/implementation-final-default-viewport.png`

## Focused comparison

| Area | Source intent | Verified implementation |
| --- | --- | --- |
| Page hierarchy | Title and compact actions above one continuous workspace | Preserved, with the product's existing organization settings switcher retained above the workspace |
| Section navigation | Horizontal, low-noise tabs with an underline | Horizontal Nuxt UI tabs use a two-pixel active underline and truthful section progress |
| Workspace | Form and live preview share one bordered surface | Full-bleed surface starts at the content edge and uses a `45/55` form/preview split |
| Brand form | Identity fields followed by a separate navigation group | `Tożsamość produktu` and `Nawigacja` are visually separated with consistent field rhythm |
| Preview | Prominent application preview with an alternate brand state | Authentic CRM mini-dashboard and a working `Aplikacja / Marka` switch |
| Density | Compact controls and restrained action hierarchy | One solid primary action, compact utility actions, consistent control sizing |
| Responsive behavior | Desktop-first composition that degrades cleanly | No horizontal overflow at `768 × 900` or `390 × 844`; workspace stacks below the desktop breakpoint |

## Iteration history

### Pass 1

- P1: preview column was too narrow relative to the selected visual.
- P1: the workspace was inset from the product sidebar instead of reading as one continuous design surface.
- P2: the active section rendered as a large filled pill rather than the selected visual's understated underline.

Corrections:

- Changed the desktop split from form-heavy to preview-heavy (`0.9fr / 1.1fr`).
- Extended the workspace to the content edges while preserving responsive gutters.
- Restyled only the editor's section indicator as an underline; preview-state tabs remain segmented controls.

### Pass 2

- No remaining P0, P1, or P2 visual issues.
- Accepted product-context differences: the existing organization settings switcher remains visible, and the preview uses a real task list instead of introducing a new chart dependency.

### Implementation review

- Disabled the complete editor fieldset when the organization is read-only.
- Added an explicit fetch-error status and alert instead of silently presenting default settings.
- Updated Nuxt UI card selectors to the v4 `data-slot` contract.
- Clarified that the progress bar represents section position, not form completion.

## Interaction and runtime checks

- `Marka → Kolory → Marka` switches sections; the `Kolory` heading and `40%` section progress were observed.
- Editing the product name exposes `Niezapisane zmiany` and enables `Zapisz zmiany`.
- Discard restores `OpenExpert`, returns the clean status, and disables save.
- `Aplikacja → Marka → Aplikacja` switches between the mini CRM and both logo surfaces.
- Browser console after desktop and responsive checks: `0` warnings, `0` errors.
- Nuxt typecheck: passed; only the pre-existing duplicated `caseUuidPattern` import warning was emitted.
