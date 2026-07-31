# Design QA — Multiwniosek

## Evidence

- source visual truth: `/Users/konradstraszewski/.codex/generated_images/019fb25f-871f-7791-903f-3137a011ce35/call_MTV2R3vJgOyzTDKKNc4uKPC7.png`
- user annotation screenshot: `/Users/konradstraszewski/Documents/GitHub/app/design-qa-multiform-form-before.png`
- implementation screenshot: `/Users/konradstraszewski/Documents/GitHub/app/design-qa-multiform-form-final.jpg`
- source pixels: 1487 × 1058
- annotation pixels: 1312 × 1190
- implementation pixels: 1280 × 720
- implementation viewport: 1280 × 720 CSS px, 1× capture
- density normalization: the workflow and form regions were compared independently from the CRM navigation frame; the high-density annotation crop was judged by control proportions and wrapping rather than raw pixels
- state: desktop, light theme, step 2 active, two selected bank applications, partially completed intake (10 of 15 answers)

## Full-view evidence

The implementation preserves the reference hierarchy: five-step horizontal progress, two-column intake workspace, live checklist preview, and a persistent action footer. The flow is embedded in the existing case page and therefore retains the CRM sidebar and case context that are absent from the standalone reference.

## Focused-region evidence

- Stepper: all five stages, completed/current/waiting states, labels, and connector rhythm are present.
- Intake: applicant/shared tabs, auto-filled answer summary, progress, grouped questions, and required-state validation are present.
- Form controls: long option labels use balanced wrapping inside equal-height, auto-fitting choices; binary questions use one aligned row each with a fixed-width two-option control.
- Live preview: current document count, applicant split, selected banks, and the shared-document explanation update from intake answers.
- Footer: back action, autosave state, primary transition, and next-step hint remain visible while the form body scrolls.

## Required-fidelity findings

- Typography: uses the existing CRM and Nuxt UI type scale while matching the reference hierarchy and compact labels.
- Spacing and layout: content proportions, card boundaries, two-column split, compact question rhythm, and sticky footer are aligned with the reference. The implementation reserves space for the host application's Agent AI control.
- Colors: deliberately use the established CRM neutral/black action tokens instead of introducing the reference's orange accent.
- Images and icons: the reference contains interface icons rather than photographic assets; matching Lucide/Nuxt UI icons are used without gradients or placeholder imagery.
- Copy: Polish labels follow the reference intent and use live case, applicant, bank, answer, and document data.
- Responsive behavior: auto-fit grids remove embedded-panel overflow; choices step down to two columns and then one column, while binary rows stack below 500 px.

## Comparison history

1. Pass 1 found the footer below the viewport, radio controls squeezed into one row, and the global Agent AI control overlapping the primary action.
2. Pass 2 introduced an internally scrolling form body, a fixed workspace footer, and explicit radio-field grids.
3. Pass 3 reserved footer space for the host control and confirmed the primary action remains unobstructed.
4. Pass 4 used the user's annotation to identify oversized pill-like controls, awkward label wrapping, and an orphaned two-column binary-question layout. The form now uses compact equal-height choices, auto-fit minimum widths, balanced labels, and aligned question rows. Post-fix measurements show no horizontal overflow: the 854 px main panel and all choice groups have equal client and scroll widths.

## Interactions tested

- Restored the seeded draft on step 2 and confirmed autosave state.
- Confirmed missing preliminary answers block progression and focus the first issue.
- Completed applicant and shared questions and generated an eight-item checklist.
- Uploaded, selected, downloaded, versioned, and removed test documents through the existing secure document APIs.
- Opened the common bank form for both applications, completed required shared fields, and reached 16 of 16 required answers.
- Reached the ZIP summary with two banks, two PDFs, and eight attachments.
- Confirmed PDF export blockers appear only at the ZIP stage when a bank template lacks target mappings.
- Restored the clean seeded partial-draft state after the functional pass.
- Switched between Jan, Anna, and the shared case form after the redesign; each branch rendered without overflow and returned to Jan.

## Runtime checks

- Browser console warnings/errors: 0
- CRM typecheck after the form redesign: passed
- Earlier landing typecheck: passed
- Focused intake tests after the form redesign: 9 passed
- Earlier intake, draft, PDF, and bundle suite: 20 passed
- Local database verification: passed
- `git diff --check`: passed
- Actionable visual discrepancies: no P0, P1, or P2 findings
- Accepted P3 differences: CRM shell around the flow, product-token accent color, live data differing from the illustrative reference, and no separate narrow-viewport screenshot in this pass

final result: passed
