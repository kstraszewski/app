# Design QA — rejestr zgód compliance

## Evidence

- Source visual truth: `/Users/konradstraszewski/.codex/generated_images/019f99a0-9547-7fa2-bb96-0d5906454c0c/exec-8830756c-b570-438b-b685-9cc211a7a5fd.png`
- Browser-rendered implementation: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-consents-register-final.jpg`
- Side-by-side comparison: `/Users/konradstraszewski/Documents/GitHub/app/apps/crm/design-qa-consents-comparison-final.jpg`
- Route: `http://127.0.0.1:3004/org/openexpert-local/consents`
- Viewport: `1410 × 1116` CSS px, light theme.
- Source pixels: `1410 × 1116`.
- Implementation pixels: `1410 × 1116` after capture with `scale: "css"`; browser-reported DPR was `1`. The CSS-scale capture removed the native screenshot density mismatch before comparison.
- State: authenticated as `admin@openexpert.local`, active-consents tab, three effective published definitions, read-only because the account has no granular compliance-management grant. The source mock shows the permission-enabled state; this state difference is intentional and is represented by the compact permission banner and hidden creation action.

## Findings

- No actionable P0, P1, or P2 visual or interaction findings remain.
- [P3] The global floating Agent AI control can overlap the lower-right edge of a consent card at the `390 px` mobile viewport. This is an existing app-shell behavior outside the consent-page changes; consent content remains reachable and the document itself has no horizontal overflow.

## Fidelity Review

- Fonts and typography: the implementation uses the product's existing typography and `CrmPageHeader` hierarchy. The title is intentionally larger than in the isolated mock because the user explicitly requested the header shared across CRM screens. Weights, line heights, truncation, and table labels remain legible.
- Spacing and layout rhythm: the mock's compact filter bar and dense register were retained. The implementation adds the canonical CRM shell, shared page margins, shared header spacing, and shared tab strip. Table rows, dividers, padding, and radius are internally consistent; no page-level overflow occurs at `1410`, `900`, or `390 px`.
- Colors and tokens: neutral surfaces, borders, semantic green published badges, warning permission state, and active-tab underline all use existing CRM/Nuxt UI tokens. The mock's amber primary button was intentionally replaced by the product's canonical primary action styling.
- Image quality and assets: the screen contains no bespoke imagery. Product icons come from the existing Lucide/Nuxt Icon system; no placeholder art, CSS drawings, custom SVG substitutes, or rasterized UI were introduced.
- Copy and content: labels are written for a compliance workflow: active, draft, archived and immutable history states; process context; required/optional state; effective-version explanation; and permission-specific read-only guidance.
- Icons and affordances: search, filter controls, lifecycle tabs, row chevrons, refresh, status badges, back navigation, and detail/history navigation use the shared product icon family and visible focusable controls.
- Accessibility: inputs have accessible labels, lifecycle and detail navigation are semantic links, the register has labeled regions, counts use live regions, disabled editing follows permissions, and no page-level horizontal overflow was found.

## Full-view Comparison Evidence

The source and final implementation were combined into one `2820 × 1116` side-by-side image and visually inspected. The information hierarchy, lifecycle navigation, immutable-version note, four-control filter row, seven-column register, row density, semantic status badges, and row navigation match the selected direction. Differences caused by the canonical CRM shell/header and by the current account's read-only permission state are intentional product constraints.

## Focused-region Comparison Evidence

A separate crop was not required after normalization: at `1410 × 1116`, the filter controls and complete register were readable in the full implementation capture. The dense table region was additionally verified through DOM measurements: its desktop content fits the CRM page; at `900 px` it scrolls only inside the register (`866 px` client width, `1080 px` content width); at `390 px` it converts to `358 px` cards with no document overflow.

## Interaction and Runtime Checks

- Lifecycle tabs: active, drafts, archived and aggregate history routes opened successfully.
- Search: filtering for `SMS` showed one matching definition and hid the unrelated entries; clearing restored all three rows.
- Detail: a consent opened from the register and rendered the shared `Treść i ustawienia` / `Historia wersji` tabs.
- History: the immutable version record, audit metadata, content hash and effective dates rendered successfully.
- Permissions: the list and detail explain read-only state; creation and publication actions are driven by separate granular compliance grants.
- Browser console: checked after the full flow; zero errors.
- Typecheck: `pnpm --filter @openexpert/crm typecheck` passed.
- Production build: `pnpm --filter @openexpert/crm build` passed. Only pre-existing Node engine and bundle-size warnings were emitted.
- Whitespace validation: `git diff --check` passed.

## Comparison History

1. Initial implementation capture used the browser's native screenshot scale and produced a misleading two-times crop. The implementation was recaptured with `scale: "css"`, giving equal `1410 × 1116` evidence before visual judgment.
2. The first product-quality review found a P1 permission mismatch: organization administrators were shown manage/publish controls even though mutation endpoints require dedicated compliance grants. The API payload now exposes only the granular manage and publish checks; the post-fix browser capture shows the correct read-only state.
3. The same review found a P2 lifecycle mismatch: the `Aktywne` tab counted every published current version, including future or expired ones. The list and count now require `effective_from <= now` and no expired `effective_to`, matching runtime consent selection. The post-fix active tab contains the three currently effective versions.
4. A P3 history-sort ambiguity was removed by renaming the option to `Najnowsza publikacja` and sorting aggregate history by version creation time rather than comparing version numbers across unrelated definitions.
5. Final side-by-side review found no remaining actionable P0/P1/P2 differences.

## Implementation Checklist

- [x] Reuse `CrmShell` and `CrmPageHeader` instead of local header/tab variants.
- [x] Add lifecycle register tabs and route-backed history.
- [x] Build a compact searchable/filterable CRM table with responsive card fallback.
- [x] Move per-consent history into its own shared-header tab.
- [x] Keep immutable-version and effective-date semantics visible.
- [x] Separate manage and publish permissions in the UI contract.
- [x] Verify desktop, tablet and mobile layout, primary interactions, browser errors, typecheck and production build.

## Follow-up Polish

- Consider globally offsetting the Agent AI floating action on narrow viewports so it never covers the lower-right edge of cards across CRM screens.

final result: passed
