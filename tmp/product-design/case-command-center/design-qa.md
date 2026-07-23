# Design QA — centrum dowodzenia sprawy (archiwum)

- Visual truth: `tmp/product-design/case-command-center/selected-command-center.png`
- Final desktop capture: `tmp/product-design/case-command-center/implementation-final-1440.png`
- Combined comparison input: `tmp/product-design/case-command-center/comparison-final.png`
- Final mobile capture: `tmp/product-design/case-command-center/implementation-mobile-390-final.png`
- Local route: `http://127.0.0.1:3004/org/openexpert-local-b14839d2/cases/4df1af0d-905b-4fc3-927b-dbbb3d01c0bb`
- QA viewports: `1440 × 1024` and `390 × 844`
- State: authenticated organization admin, dark theme, two applicants, one selected PKO offer, three attached but unverified documents, no saved property or insurance products

## Visual comparison

The selected variant and the final implementation were resized to the same `1440 × 1024` frame and inspected side by side in one comparison image.

- Layout matches the selected command-center hierarchy: compact case header, four route-backed tabs, health strip, primary plan column, sticky action rail, applicants, activity, and selected offers.
- Typography, monochrome surfaces, one-pixel borders, radii, spacing rhythm, status accents, OpenExpert branding, real PKO catalog logo, and Lucide icons stay within the existing CRM design system.
- Differences in owner, dates, stage, blocker count, deadlines, and activity count are intentional because the implementation renders current CRM data instead of mock values.
- Missing property and insurance data use explicit empty states. No fictional policy, deadline, task, or applicant data is presented.

## Findings and fixes

### Iteration 1 — data truth and information architecture

- P1: the former page mixed the mortgage workflow, clients, documents, and Multiwniosek into one long view.
- Fix: introduced shareable `Podsumowanie`, `Kredyt i oferty`, `Dokumenty i wnioski`, and `Historia` views. The overview now separates credit, property, life insurance, and property insurance as parallel workstreams.

### Iteration 2 — property editor runtime

- P1: the first property slideover render failed because the browser rejected `square-meter` in `Intl.NumberFormat`.
- Fix: changed the label to `Powierzchnia (m²)` and kept locale-aware numeric formatting without the unsupported unit. The complete slideover then rendered and accepted test values.

### Iteration 3 — mobile shell

- P1: at `390 px`, the full desktop navigation pushed the case content below the first viewport.
- Fix: converted the mobile shell to a compact top bar with an explicit `Otwórz nawigację` / `Zamknij nawigację` control. The final page reports `scrollWidth = clientWidth = 390`.

No actionable P0, P1, or P2 findings remain.

## Functional verification

- Opened every route-backed case tab and verified the correct content and URL state.
- Verified the primary `Otwórz następny krok` action opens document work for the current real blocker.
- Opened offer details from the command center.
- Opened the property editor, entered an address, city, postal code, and confirmed the `600 000 zł` scenario suggestion; closed without mutating test data.
- Opened the life-insurance process starter and verified its honest pre-policy explanation; closed without mutating test data.
- Verified the documents checklist and native CRM Multiwniosek workspace.
- Verified history and the empty open-task state.
- Verified the quick-action dropdown and mobile navigation toggle.
- CRM TypeScript check and production Nuxt build pass. Build emits only existing sourcemap and large-chunk warnings.

## Accessibility and responsive checks

- Sections, process areas, side rails, tabs, dialogs, inputs, and actions have semantic roles and accessible names.
- Keyboard-operable links, buttons, comboboxes, and slideovers use Nuxt UI primitives.
- Desktop and mobile states have no horizontal overflow or clipped persistent actions.
- Temporary viewport override was reset after responsive QA.

## Iteration 4 — compact workstream actions and Remont order

- Source feedback: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-9ebf987f-f1b4-4f0d-a30b-22825adefc65.png`
- Focused implementation capture: `tmp/product-design/case-command-center/implementation-remont-compact-plan.png`
- Combined comparison input: `tmp/product-design/case-command-center/comparison-remont-compact.png`
- Local route: `http://127.0.0.1:3027/org/openexpert-local-04b35ead/cases/feed7482-ed4d-46ad-b97f-b5aa1a84ab7f`
- QA viewport: `919 × 1234` CSS pixels at DPR 1; the reference crop is `1390 × 1318` pixels at 144 dpi.

### Finding and fix

- P2: the secondary workstream action chips were visually too large, and `Remont` appeared before the two insurance workstreams.
- Fix: reduced the chips from `7 × 10 px` padding, `11 px` type, and `8 px` radius to `4 × 8 px` padding, `10 px` type, and `6 px` radius. Their measured rendered height is now `22 px`.
- Fix: reordered the workstreams to `Ubezpieczenie na życie`, `Ubezpieczenie nieruchomości`, then `Remont`.
- Typography family, colors, borders, row rhythm, Lucide icons, and product copy remain unchanged.
- The focused before/after comparison confirms the smaller controls and requested ordering without clipping or overlap.

### Verification

- Browser DOM order matches the requested sequence.
- Both insurance action chips measure about `114 px × 22 px`; the cash-loan chip measures about `133 px × 22 px`.
- CRM TypeScript check passes; it emits only the existing duplicate `caseUuidPattern` warning.
- No actionable P0, P1, or P2 findings remain.

final result: passed
