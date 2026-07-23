# Design QA — nawigacja i kalendarz eksperta (archiwum)

## Evidence

- Source visual truth: `tmp/product-design/calendar-navigation/codex-clipboard-9e26826d-2529-4c4a-91ce-8161d36edbc6.png`
- Browser-rendered desktop implementation: `tmp/product-design/calendar-navigation/openexpert-calendar-final-desktop.png`
- Browser-rendered mobile implementation: `tmp/product-design/calendar-navigation/openexpert-calendar-final-mobile.png`
- Focused side-by-side comparison: `tmp/product-design/calendar-navigation/openexpert-sidebar-comparison.png`
- Appointment details state: `tmp/product-design/calendar-navigation/openexpert-calendar-modal.png`
- Local route: `http://127.0.0.1:3000/org/openexpert-local-04b35ead/calendar`
- Desktop viewport: `1440 × 1000` CSS pixels at DPR 1.
- Mobile viewport: `390 × 844` CSS pixels at DPR 1.
- Source dimensions: `498 × 610` pixels, interpreted as a 2× capture of an approximately `249 × 305` CSS-pixel sidebar region.
- Implementation dimensions: full view `1440 × 1000` pixels; sidebar `248 × 1000` CSS pixels. For the focused comparison, a `248 × 305` implementation crop was resized to `498 × 610` pixels to normalize density against the source. The combined comparison is `1020 × 610` pixels with a 24-pixel divider.
- State: authenticated organization administrator, dark theme, expanded sidebar, `Kalendarz` active, expert `Local Administrator · Ty`, week `20–26 lipca 2026`. A single synthetic confirmed appointment was used only to verify event placement and details, then removed from the local database.

## Findings

No actionable P0, P1, or P2 findings remain.

- **Fonts and typography:** navigation hierarchy, compact uppercase group labels, body weights, mono metadata, line height, and truncation follow the existing OpenExpert tokens. The focused comparison preserves the source's label/link scale and optical hierarchy; softness on the implementation half is caused only by the documented 1×→2× normalization.
- **Spacing and layout rhythm:** the live sidebar measures 248 CSS pixels, matching the source's inferred 249-pixel width. Link spacing, icon alignment, active-pill radius, border weight, and dark-surface rhythm match the visual target. The new `Kalkulatory` group and `Kalendarz` link are intentional product changes requested by the user. The desktop calendar stays inside the content frame; mobile switches to an agenda without horizontal overflow.
- **Colors and visual tokens:** black sidebar, muted gray text, white active text, one-pixel neutral borders, and active-state contrast map to the source and existing CRM tokens. Confirmed appointments use the product's semantic success green without changing the monochrome base.
- **Image quality and asset fidelity:** the target contains no photographic or illustrative assets. The implementation reuses the real OpenExpert brand mark and the existing Lucide icon family; no emoji, handcrafted SVG, CSS drawing, or placeholder asset substitutes are present.
- **Copy and content:** `Kalkulatory`, `Zdolność`, `Hipoteki`, `Ekspert`, `Dashboard`, `Kalendarz`, `Klienci`, `Sprawy`, and `Widgety` are coherent and match the requested information architecture. Calendar labels, counts, empty state, statuses, filters, and details are in Polish.
- **Accessibility and behavior:** semantic headings, navigation groups, labeled expert/date controls, accessible event names, keyboard-operable buttons and links, visible active states, and practical mobile controls are present.

## Comparison history

### Iteration 1 — mobile shell spacing

- Earlier finding `[P2]`: at `390 × 844`, the inherited header copy basis left a large blank vertical gap before the calendar controls.
- Fix: the mobile shell now resets `.crm-header__copy` to `flex-basis: auto` below 900 pixels.
- Post-fix evidence: `openexpert-calendar-mobile-before-fix.png` versus `openexpert-calendar-final-mobile.png`; the title, metadata, filters, toolbar, and first agenda rows now fit into the initial viewport without overlap.

### Iteration 2 — direct-load hydration

- Earlier finding `[P1]`: a direct reload could render a client-only pending state that differed from the server markup, producing hydration mismatches and leaving navigation controls temporarily non-responsive.
- Fix: appointment loading now uses SSR-aware `useAsyncData`, sharing the same initial state between server and client.
- Post-fix evidence: a fresh direct load rendered the confirmed appointment immediately, sidebar/week controls responded, and no new hydration warning or calendar error appeared in the browser log.

### Final visual pass

- The source and normalized implementation sidebar were opened together in `openexpert-sidebar-comparison.png`.
- The comparison confirms matching proportions, typography hierarchy, icon family, spacing rhythm, dark palette, and active-pill treatment. Differences in group order, added section label, and active route are intentional consequences of the requested navigation split and calendar screen.

## Functional verification

- Verified both navigation groups and their exact route targets on desktop and in the mobile drawer.
- Verified expert selection, date input, previous/next week, `Dziś`, URL synchronization, manual refresh, confirmed-event placement, and the empty week state.
- Opened an appointment and verified date, time, status, service, facility, expert, timezone, contact links, notes, and client action.
- Checked the responsive weekly grid at `1440 × 1000` and agenda at `390 × 844`.
- Checked browser errors after the final direct load: no new calendar or hydration errors were recorded. Older development-log entries from the existing HMR, organization-design SSR request, and Nuxt Icon runtime remain outside this change and did not affect the verified render.
- Final CRM typecheck passes, production build passes, and all 42 Node tests pass.

## Open questions

- None for the requested scope. Creating, rescheduling, or cancelling meetings remains a separate product flow.

## Implementation checklist

- [x] Split calculators from expert navigation.
- [x] Add an expert calendar route backed by real appointments.
- [x] Support desktop, mobile, loading, empty, error, and details states.
- [x] Verify visual fidelity, interactions, console state, typecheck, build, and tests.
- [x] Remove synthetic QA data from the local database.

final result: passed
