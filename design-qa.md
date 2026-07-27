# Design QA — Design w Ustawieniach

## Evidence

- Source visual truth: `tmp/product-design/settings-design-navigation/codex-clipboard-460ce64f-20fd-4d61-bea8-329738e3f819.png`
- Browser-rendered desktop implementation: `tmp/product-design/settings-design-navigation/openexpert-settings-design-desktop.png`
- Browser-rendered mobile implementation: `tmp/product-design/settings-design-navigation/openexpert-settings-design-mobile.png`
- Focused side-by-side comparison: `tmp/product-design/settings-design-navigation/openexpert-settings-nav-comparison.png`
- Local route: `http://127.0.0.1:3000/org/openexpert-local-04b35ead/settings/design`
- Desktop viewport: `1440 × 1000` CSS pixels at DPR 1.
- Mobile viewport: `390 × 844` CSS pixels at DPR 1.
- Source dimensions: `522 × 574` pixels, interpreted as a 2× capture of an approximately `261 × 287` CSS-pixel sidebar region.
- Implementation dimensions: full desktop view `1440 × 1000` pixels and full mobile view `390 × 844` pixels. For the focused comparison, a `261 × 287` implementation crop was resized to `522 × 574` pixels to normalize density against the source. The combined comparison is `1068 × 574` pixels with a 24-pixel divider.
- State: authenticated organization administrator, dark theme, expanded desktop sidebar, `Ustawienia` active, internal `Design` tab active.

## Findings

No actionable P0, P1, or P2 findings remain.

- **Information architecture:** the standalone `Design` item was removed from `Administracja organizacji`. The Design editor now lives at `/settings/design` and is exposed as the `Design` tab inside the settings area, next to `Konfiguracja`.
- **Navigation state:** `Ustawienia` stays visibly active for both `/settings` and nested `/settings/design`; the internal tab identifies the exact subsection. The old `/design` route redirects to the nested route while preserving query parameters and hash.
- **Fonts and typography:** the compact uppercase section label, navigation scale, tab labels, mono metadata, and editor hierarchy use the existing OpenExpert typography tokens. Any softness in the focused comparison comes only from documented 1×→2× normalization.
- **Spacing and layout rhythm:** sidebar spacing, icon alignment, active-pill radius, borders, and grouping remain consistent with the source. Removing the standalone Design row closes the gap before `SuperAdmin`, while the settings tabs give the destination a clear local hierarchy.
- **Colors and visual tokens:** black sidebar, muted gray labels, white active text, one-pixel neutral borders, and dark-surface contrast match the source and existing CRM tokens.
- **Image quality and asset fidelity:** the target contains no photographic or illustrative assets. The implementation reuses the existing Lucide icon family and real application brand assets; no emoji, placeholder images, handcrafted SVG, or CSS illustration substitutes were introduced.
- **Responsive behavior:** at `390 × 844`, the settings tabs remain readable in two columns, the editor has no horizontal overflow, and the mobile drawer contains only `Ustawienia` under administration.
- **Accessibility:** active navigation exposes `aria-current`, settings destinations are keyboard-operable links, and visible active states remain distinct in both the global sidebar and local settings navigation.

## Comparison history

### Iteration 1 — nested sidebar state

- Earlier finding `[P2]`: after moving the editor to `/settings/design`, the global `Ustawienia` item was not visually active because the router's exact matching did not cover the nested route.
- Fix: the sidebar now explicitly recognizes nested settings paths and applies both the active class and `aria-current="page"`.
- Post-fix evidence: the desktop screenshot and focused side-by-side comparison show one active global item (`Ustawienia`) and one active local tab (`Design`).

### Final visual pass

- The source and normalized implementation sidebar were inspected together in `openexpert-settings-nav-comparison.png`.
- The comparison confirms matching sidebar proportions, hierarchy, icon family, spacing rhythm, dark palette, and active-pill treatment. The missing standalone `Design` row and active `Ustawienia` state are the intentional requested changes.

## Functional verification

- Verified `/settings` exposes `Konfiguracja` and `Design` as internal navigation.
- Verified clicking `Design` opens `/settings/design` without losing the existing editor functionality.
- Verified the global `Ustawienia` item remains active on the nested route.
- Verified the legacy `/design?source=legacy#colors` URL redirects to `/settings/design?source=legacy#colors`.
- Verified the desktop layout at `1440 × 1000` and mobile layout at `390 × 844`; no horizontal overflow was found.
- Verified the mobile drawer no longer contains a standalone `Design` entry.
- Checked browser logs after the final render: no new routing or settings-navigation errors were introduced. Existing development-only HMR, organization-design SSR authorization, Nuxt Icon, and synthetic missing-hash warnings remain outside this change and did not affect the verified UI.
- CRM typecheck passes, the production build passes, and all 42 Node tests pass.

## Open questions

- None for the requested scope.

## Implementation checklist

- [x] Remove `Design` as a standalone administration sidebar item.
- [x] Add `Design` inside the settings section.
- [x] Preserve the existing editor and legacy URLs.
- [x] Keep parent and child navigation states accessible and visually clear.
- [x] Verify desktop, mobile, interactions, browser logs, typecheck, build, and visual fidelity.

final result: passed

---

# Design QA — publiczny wybór terminu

## Evidence

- Source issue: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-3ed25b14-bf85-452b-b67c-20c55de76371.png`
- Selected design direction (option 3): `/Users/konradstraszewski/.codex/generated_images/019f9a70-5c4c-7331-af6b-724f57a1e629/call_VWrFyIJVHSGAhCYZUAIFT1s4.png`
- Browser-rendered desktop state with the expert picker: `/private/tmp/openexpert-booking-option3-wide.jpg`
- Browser-rendered mobile state: `/private/tmp/openexpert-booking-mobile.jpg`
- Focused source/implementation comparison: `/private/tmp/openexpert-booking-option3-comparison.jpg`
- Local route: `http://127.0.0.1:3004/book/d3100006-2000-4000-8000-000000000001?expertId=2aad1608-7c86-480c-987f-2f1abc4dc6a2`
- Verified desktop viewport: `919 × 863` CSS pixels at DPR 2.
- Verified mobile viewport: `390 × 844` CSS pixels.

## Findings

No actionable P0, P1, or P2 findings remain.

- **Time semantics:** all seven days now share one vertical time axis. `10:15` and `12:15` occupy separate rows (`642px` and `1058px` from the viewport top in the verified state), so different hours can no longer appear equivalent.
- **Desktop scanning:** the full week stays visible at once, with exact-time rows, clear empty cells, selected-day emphasis, and a compact “show later hours” expansion.
- **Context selection:** service and expert now form one aligned context bar. The expert picker contains an avatar treatment, name, professional fallback label, availability status, and an “any available expert” option.
- **Data fidelity:** the public API does not currently expose a safe public expert photo or professional title. The implementation therefore uses initials and the honest label `Ekspert OpenExpert`; it does not fabricate a portrait or expose an internal permission role.
- **Spacing:** the page frame keeps a guaranteed `24px` desktop gutter and `18px` mobile gutter. At the verified desktop width, both document and body `scrollWidth` equal `919px`, so the redesign introduces no horizontal page overflow.
- **Responsive behavior:** below the desktop breakpoint, the week becomes a day strip plus a vertical list of times, while service and expert controls stack into one column.
- **Accessibility:** the desktop week uses table, row, row-header, column-header, and cell semantics. Every available and unavailable cell names the exact date and time, and the Nuxt UI expert menu retains keyboard selection behavior.

## Focused comparison evidence

- The source showed independently stacked day columns, which made `10:15` and `12:15` look horizontally equivalent.
- The implementation replaces that ambiguity with a single left-hand time axis and one shared row per exact time.
- The selected option 3 visual direction is preserved: full-week desktop overview, compact context bar, dark OpenExpert styling, and a persistent booking summary.

## Functional verification

- Verified the date range renders as `26 lipca – 1 sierpnia 2026`.
- Verified switching between “Dowolny dostępny ekspert” and the named expert.
- Verified selecting the exact `10:15` slot updates the summary and enables the next-step action.
- Verified desktop and mobile layouts without horizontal document overflow.
- Checked browser warnings and errors after the final reload: none.
- CRM typecheck, four booking-slot tests, and `git diff --check` pass.

## Open questions

- A real portrait and a domain-specific title can be added later when the organization exposes explicit public profile fields for them.

## Implementation checklist

- [x] Apply the selected option 3 direction.
- [x] Add one shared vertical time axis for the entire week.
- [x] Keep all seven days visible on desktop.
- [x] Redesign the expert picker with avatar treatment and supporting information.
- [x] Correct page and control spacing.
- [x] Preserve a focused mobile booking flow.
- [x] Verify interactions, browser logs, types, tests, and visual quality.

final result: passed

---

# Design QA — delegowanie zadań ze sprawy

## Evidence

- Source visual truth: `/Users/konradstraszewski/.codex/generated_images/019f9b03-9123-7252-ad7f-232fe77204fb/call_muFG5FbKqTM0qwZ2lT5zeFrl.png`
- Browser-rendered implementation: `/private/tmp/openexpert-delegation-qa/modal-step2-final-1488x1024.png`
- Exact side-by-side comparison: `/private/tmp/openexpert-delegation-qa/comparison-source-vs-implementation.png`
- Delegation oversight panel: `/private/tmp/openexpert-delegation-qa/delegations-panel-admin.png`
- Recipient lifecycle and expanded history: `/private/tmp/openexpert-delegation-qa/delegation-recipient-history.png`
- Mobile recipient step: `/private/tmp/openexpert-delegation-qa/modal-step2-mobile-390x844.png`
- Mobile access-step summary: `/private/tmp/openexpert-delegation-qa/modal-step3-mobile-bottom-390x844.png`
- Local route: `http://127.0.0.1:3004/org/openexpert-local/cases/6a3a86c3-4081-5480-b849-0c13c3caeb71?view=delegations`
- Source and implementation viewport: `1488 × 1024` CSS pixels at DPR 1, captured as `1488 × 1024` pixels.
- Mobile viewport: `390 × 844` CSS pixels at DPR 1, captured as `390 × 844` pixels.
- Comparison state: authenticated local administrator, dark theme, Warszewo case, step 2 `Realizator`, Anna Nowak selected, realistic seeded team data.

## Findings

No actionable P0, P1, or P2 findings remain.

- **Information architecture:** delegation is a task attached to the existing case, not a nested case. A dedicated `Delegacje` view provides counts, assignee, acceptance state, deadline, meetings, access context, and expandable history.
- **Flow:** the three-step structure matches the selected variant: define the outcome, choose a recipient, then set the deadline and shared context. `Ostatnio delegowałeś do` is deliberately shown before the full searchable team directory.
- **Fonts and typography:** modal title, compact step labels, task names, metadata, badges, and helper text reuse the existing OpenExpert and Nuxt UI type tokens.
- **Spacing and layout rhythm:** the final desktop modal is `944` CSS pixels wide, with a distinct task/case/client summary column and a persistent footer. Its vertical position, proportions, step header, body split, and footer align closely with the reference at the same viewport.
- **Colors and visual tokens:** semantic green identifies the current flow, selected recipient, focus path, and primary continuation action. Neutral surfaces and borders remain consistent with the existing dark CRM.
- **Assets:** the implementation uses the installed Lucide icon set and real initials from seeded user profiles. No emoji, handcrafted SVG, CSS illustration, or placeholder image was introduced.
- **Copy and content:** all labels describe delegation as `zadanie`; no user-facing `podsprawa` wording remains. Recipient workload, team, recent-delegation count, deadline, access scope, meetings, and history come from real API data.
- **Accessibility:** the modal has a labelled dialog, semantic three-step progress, grouped radio choices, labelled form fields, keyboard-operable actions, Cmd/Ctrl+Enter support, visible focus states, error alerts, and a focus trap supplied by `UModal`.
- **Responsive behavior:** at `390 × 844`, the modal becomes full-screen, has no horizontal overflow, keeps the footer action reachable, and scrolls the long access step independently to its summary.

## Focused comparison evidence

- The exact-size comparison places the `1488 × 1024` reference and implementation in one image.
- Both use the same dark case context, centered modal, three-step header, recipient selection, right-side case summary, and green continuation path.
- The implementation intentionally uses the application's initials-based avatars and prioritizes recent recipients above team search. These preserve the selected concept while matching real product data and existing CRM conventions.
- The mobile captures confirm that the same flow remains usable without introducing a separate mobile-only interaction model.

## Comparison history

### Iteration 1 — restore the selected option 3 composition

- Earlier finding `[P1]`: the first implementation used a narrow modal without the reference's right-side context summary.
- Fix: set the desktop modal to `944` CSS pixels, introduced the task/case/client summary column, and changed recent recipients to a vertical quick-selection list.
- Post-fix evidence: the modal body now uses the same primary/summary split as the source.

### Iteration 2 — align proportions and action hierarchy

- Earlier finding `[P2]`: the step header and recipient directory made the modal materially taller than the reference, while the primary action remained neutral.
- Fix: compacted the stepper, hid redundant desktop helper copy, constrained the initial team list, used semantic green for selection/focus/continuation, and retained full search access to the team.
- Post-fix evidence: final modal bounds and footer position closely track the source, with a clear green progression path.

### Iteration 3 — remove runtime noise

- Earlier finding `[P2]`: the first access-step render referenced an unavailable `calendar-lock-2` icon.
- Fix: replaced it with the installed `calendar-clock` icon.
- Post-fix evidence: a fresh browser tab completed all three modal steps with no console warnings or errors.

## Functional verification

- Created a delegated insurance task as the local administrator and verified the success state plus the case counter increasing from 2 to 3.
- Logged in as Anna Nowak, accepted the task, started work, completed it, and expanded the four-event audit trail.
- Verified the delegator view exposes pending/in-progress/completed counts, deadlines, shared data, acceptance timestamps, the seeded linked meeting, and history.
- Verified server-authoritative current-user identity after a database reset so recipient actions render reliably on a fresh session.
- Verified responsive steps 2 and 3 at `390 × 844` with `document.body.scrollWidth === 390`.
- Verified a fresh browser tab after the final fix: no warnings or errors.
- All CRM tests pass: `95/95`.
- Delegation unit tests pass: `7/7`.
- CRM typecheck, production build, `git diff --check`, full database reset/seed verification, RLS verification, and the authenticated HTTP lifecycle smoke pass.

## Open questions

- None for the requested scope.

## Implementation checklist

- [x] Use `Deleguj zadanie` consistently instead of creating a subcase.
- [x] Add a pleasant three-step delegation modal based on option 3.
- [x] Show recent recipients, team, workload, deadline, and shared context.
- [x] Add accept, reject-with-reason, cancel, start, and complete lifecycle actions.
- [x] Preserve an append-only task history and show linked meetings.
- [x] Add realistic users and delegation states to the database seed.
- [x] Enforce organization membership, lifecycle consistency, RLS, audit protection, and idempotency.
- [x] Verify desktop, mobile, clean browser logs, tests, database, types, and production build.

final result: passed

---

# Design QA — tygodniowy wybór terminu rezerwacji

## Evidence

- Selected design target: `/Users/konradstraszewski/.codex/generated_images/019f9a70-5c4c-7331-af6b-724f57a1e629/call_7SMuv0qCX6v5leB6LTEczGho.png`
- Browser-rendered implementation: `/private/tmp/openexpert-booking-week-final-selected.jpg`
- Full side-by-side comparison: `/private/tmp/openexpert-booking-week-comparison-final.jpg`
- Local route: `http://127.0.0.1:3004/book/d3100006-2000-4000-8000-000000000001?expertId=2aad1608-7c86-480c-987f-2f1abc4dc6a2`
- Design dimensions: `1487 × 1058` pixels.
- Implementation viewport: `1280 × 720` CSS pixels at DPR 2; full-page browser capture: `1280 × 1037` pixels.
- Comparison dimensions: `2978 × 1205` pixels with a four-pixel divider.
- State: dark theme, OpenExpert Szczecin Centrum, credit-capacity service, Local Administrator, rolling seven-day range, Sunday 10:15 selected.

## Findings

No actionable P0, P1, or P2 findings remain in the requested booking flow.

- **Information architecture:** desktop exposes all seven days simultaneously, with times flowing vertically inside each day. Mobile switches to a horizontally scrollable day strip and one vertical list of times.
- **Layout and hierarchy:** the generic outer card was removed, the progress indicator and booking context were compacted, and the calendar now begins near the same vertical position as the selected design.
- **Navigation:** previous and next controls flank the visible date range. Moving between weeks clears stale selections and loads the complete seven-day range in one public HTTP request.
- **Typography and density:** the existing OpenExpert type system, compact control scale, and mono progress numerals are preserved. Slot counts use correct Polish singular and plural forms.
- **Colors and states:** available, empty, selected, disabled, loading, and error states use existing semantic tokens. The selected slot uses the configured booking accent and a visible focus outline.
- **Icons and assets:** the existing OpenExpert mark and installed Lucide icons are used throughout. The unsupported mobile check icon was replaced with the bundled `circle-check` icon.
- **Copy and trust:** unsupported reminder copy was removed. The remaining trust line only promises free booking and immediate confirmation, both implemented by the current flow.
- **Accessibility:** slot controls are semantic pressed buttons with full date-and-time accessible names; the date header, week navigation, progress steps, and contact section are labelled. After `Dalej`, focus moves to the contact heading.
- **Responsive behavior:** at `≤900px` the seven-column grid is replaced by the mobile day strip and one-column time list; at `≤720px` the widget becomes full-screen, fields stack, and the action bar becomes a full-width vertical layout. The selected in-app browser exposes a fixed desktop viewport, so the responsive pass was verified through the rendered component contract, breakpoint styles, and production build rather than a separate mobile capture.

## Comparison history

### Iteration 1 — weekly desktop structure

- Earlier finding `[P1]`: the first implementation retained a large rounded outer card, placed both week arrows together, and delayed the calendar with excess context spacing.
- Fix: removed the desktop card frame, moved navigation to opposite sides of the date range, hid redundant visible field labels while retaining accessible names, and reduced progress/context spacing.
- Post-fix evidence: the calendar begins at approximately the same vertical level as the design and all seven days fit without document overflow.

### Iteration 2 — interaction and accessibility

- Earlier finding `[P1]`: collapsing the hours after selecting a late slot could hide the selected control while the sticky summary still showed it.
- Fix: the collapsed list now keeps an out-of-range selected slot visible.
- Earlier finding `[P1/P2]`: moving to contact data left focus on the page body.
- Fix: the contact heading is programmatically focusable and receives focus before smooth scrolling.
- Earlier finding `[P2]`: mobile loading could disappear because the desktop skeleton was hidden at the mobile breakpoint.
- Fix: mobile now renders a single-column loading skeleton.
- Earlier finding `[P2]`: the global later-hours control could appear on mobile when only another day had extra slots.
- Fix: desktop and mobile use separate visibility rules, with mobile scoped to the selected day.

### Final visual pass

- The selected design and final implementation were inspected together in `openexpert-booking-week-comparison-final.jpg`.
- Intentional differences are limited to real product data and functional service/expert selectors. The selected design's hierarchy, seven-day structure, vertical time flow, sticky summary, and accent treatment are preserved.

## Functional verification

- Verified the full seven-day range, empty days, later-hours expansion, selected state, sticky summary, and previous/next week navigation in the in-app browser.
- Verified selecting 16:00, collapsing the list, and retaining both the selected control and 16:00 summary.
- Verified `Dalej` opens the contact step and focuses `#booking-contact-title`; returning to `Termin` restores the weekly picker.
- Verified the current browser log has no new warnings or errors after the final render.
- Booking date/slot tests pass: `4/4`.
- CRM production build passes.
- `git diff --check` passes.
- The repository-wide CRM typecheck is currently blocked by two unrelated, concurrently added task-delegation API files that omit selected row fields; the booking changes produced no type errors, and the booking typecheck had passed before those unrelated files appeared.

## Open questions

- None for the requested booking-calendar scope.

## Implementation checklist

- [x] Show a rolling seven-day desktop calendar.
- [x] Keep times vertical within each day.
- [x] Use one selected day and one vertical list on mobile.
- [x] Load one week per public request.
- [x] Preserve a selected late slot when collapsing the list.
- [x] Add progressive contact disclosure and focus management.
- [x] Verify visual fidelity, interactions, browser logs, unit tests, formatting, and production build.

final result: passed

---

# Design QA — pełnoekranowe studio mapowania PDF

## Evidence

- Selected visual direction: `/Users/konradstraszewski/.codex/generated_images/019f99a0-9547-7fa2-bb96-0d5906454c0c/call_G9K84vpjcfsNnbMQfmgUMRP0.png`
- Browser-rendered final state: `/private/tmp/openexpert-design-qa/pdf-mapping-studio/implementation-1536x1024-final-v3.png`
- Focused side-by-side comparison: `/private/tmp/openexpert-design-qa/pdf-mapping-studio/comparison-final-v3.png`
- Responsive state: `/private/tmp/openexpert-design-qa/pdf-mapping-studio/implementation-1180x800-final-v3.png`
- Local route: `http://127.0.0.1:3004/org/openexpert-local/settings/institutions/c40b3a79-21cb-4a19-9be9-e1886b361614/pdf-templates/erste-mortgage-2026`
- Primary viewport: `1536 × 1024` CSS pixels at DPR 1.
- Responsive viewport: `1180 × 800` CSS pixels at DPR 1.
- State: authenticated organization administrator, dark theme, collapsed CRM sidebar, Erste draft revision 2, `applicants.2.pesel` selected.

## Findings

No actionable P0, P1, or P2 visual findings remain.

- **Information architecture:** the former status card, full-width stale-validation warning, and separate mode toolbar were replaced by a compact release header and one studio toolbar. The working area now begins immediately below the header.
- **Workspace:** the screen uses a full-height three-column layout: mapped-field browser, PDF canvas, and semantic inspector. Each pane owns its scroll state, while page, selection, mapping count, and review count remain visible in the bottom status bar.
- **Save and validation state:** save state is expressed once in the header with a status dot and two short lines. Editing changes it to `Niezapisane / Walidacja nieaktualna`; undo returns it to `Zapisano / Szkic r2`.
- **Semantic contract:** the selected third-applicant PESEL exposes applicant identity, form question, help text, semantic description, semantic role, AI hints/evidence, review status, and geometry without competing with the PDF.
- **Responsive behavior:** at `1180 × 800`, the release header remains a single non-overlapping row, all studio tools remain reachable, and the editor preserves all three work panes with horizontal workspace scrolling only where required.
- **Visual tokens:** typography, borders, surfaces, warning/success tones, buttons, and icons use the existing OpenExpert/Nuxt UI design tokens. No placeholder imagery, emoji, handcrafted SVG, or decorative asset was introduced.
- **Accessibility:** controls retain visible focus styles and text labels or accessible names; status is conveyed by text in addition to color; field and page controls remain keyboard-operable.

## Focused comparison evidence

- The comparison confirms the same core hierarchy as the selected direction: thin release header, persistent mapping browser, dominant PDF canvas, semantic inspector, and bottom status bar.
- The implementation intentionally keeps the existing CRM sidebar and uses a horizontal local toolbar instead of the concept's separate vertical tool rail.
- The implementation renders the real nine-page Erste source and real template bindings rather than the illustrative mock document.

## Comparison history

### Iteration 1 — remove duplicated status and navigation chrome

- Replaced the large status grid and validation alert with a compact save/release header.
- Moved Visual/JSON, AI, version details, edit mode, undo/redo, labels, and zoom into one toolbar.

### Iteration 2 — preserve workspace height

- Added an explicit CRM workspace mode that removes container width and padding constraints.
- Constrained panels to independent scroll areas and added the persistent bottom status bar.
- Corrected the `1180 × 800` header so actions no longer wrap over the studio.

### Iteration 3 — runtime and scroll cleanup

- Made workspace route detection deterministic on server and client, removing the hydration mismatch.
- Added the studio-only Lucide icons to the client bundle.
- Prevented vertical root scrolling from moving the toolbar and status bar out of view.
- Final browser reload produced no warnings or errors.

## Functional verification

- Selected `applicants.2.pesel` from the real PDF overlay and verified the complete third-applicant semantic contract.
- Switched to raw JSON and returned to the visual studio.
- Opened the version-details popover and verified validation metrics and revision history.
- Nudged the selected field, verified the dirty/stale state, then undid the change and verified the saved revision state was restored.
- Verified the `1536 × 1024` and `1180 × 800` layouts.
- Browser console after the final render and interaction pass: no warnings or errors.
- `test:multiform-template-editor`: 10/10 passed.
- `test:mortgage-template-ai`: 4/4 passed.
- `git diff --check`: passed.
- Full CRM typecheck is currently blocked only by unrelated implicit-`any` errors in the concurrently added task-delegation API (`tasks/assignees.get.ts`); no type errors were reported for the studio files.

## Open questions

- None for the selected full-screen studio scope.

## Implementation checklist

- [x] Use a compact release header instead of permanent status cards.
- [x] Keep one local studio toolbar.
- [x] Make the PDF editor full-height inside the CRM shell.
- [x] Preserve separate scrolling for mappings, PDF, and inspector.
- [x] Show the semantic field contract in the inspector.
- [x] Preserve visual/JSON, AI, validation, save, publish, undo, and review behavior.
- [x] Verify real data, responsive layout, interactions, browser logs, and focused visual comparison.

final result: passed

---

# Design QA — przycisk Google Business Profile

## Evidence

- Source visual truth: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-6c50dcdb-602a-4eae-b489-af920fd5c730.png`
- Browser-rendered dark implementation: `/private/tmp/openexpert-design-qa/google-business-profile-dark-full.png`
- Focused dark implementation: `/private/tmp/openexpert-design-qa/google-business-profile-dark-focused.png`
- Browser-rendered light implementation: `/private/tmp/openexpert-design-qa/google-business-profile-light-full.jpg`
- Focused light implementation: `/private/tmp/openexpert-design-qa/google-business-profile-light-focused.png`
- Normalized implementation crop: `/private/tmp/openexpert-design-qa/google-business-profile-dark-normalized.png`
- Focused before/after comparison: `/private/tmp/openexpert-design-qa/google-business-profile-before-after.png`
- Local route: `http://127.0.0.1:3004/org/openexpert-local/facilities/7e1df69d-488f-454c-bafc-ac0948d9d8b1`
- Source dimensions: `796 × 260` pixels, interpreted as a DPR 2 capture of an approximately `398 × 130` CSS-pixel action region.
- Implementation viewport: `1280 × 720` CSS pixels at DPR 2. The browser capture is normalized to `1280 × 720` pixels.
- Focused implementation dimensions: `451 × 130` pixels. A `398 × 130` crop was normalized to `796 × 260` pixels for direct comparison with the source.
- Combined comparison dimensions: `1616 × 260` pixels with a `24`-pixel divider.
- State: authenticated organization administrator, OpenExpert Szczecin Centrum facility, overview section, verified in dark and light themes.

## Findings

No actionable P0, P1, or P2 findings remain.

- **Brand recognition:** the generic storefront icon was replaced with the real multicolor Google G asset from the Iconify SVG Logos collection.
- **Colors:** the button uses a restrained Google-blue surface tint, border, shadow, hover halo, and focus outline while retaining the CRM's semantic background and text tokens.
- **Dark and light themes:** the color mix adapts to `--ui-bg`; text remains high contrast, and the multicolor mark stays legible on a small white tile in both themes.
- **Spacing and layout:** the button remains in the existing actions group, measures `307.7 × 42` CSS pixels, and keeps the original copy and section alignment.
- **Typography:** the existing product font and 16-pixel label are preserved, with a moderately emphasized weight appropriate for an integration action.
- **Asset quality:** the Google mark is a real vector asset with a `16 × 16` intrinsic view box, rendered without blur or stretching.
- **Accessibility:** the visible button label remains its accessible name. The repeated logo is decorative (`aria-hidden` with an empty image alternative), and a visible keyboard focus outline is defined.

## Focused comparison evidence

- The left side of `google-business-profile-before-after.png` shows the original neutral storefront treatment.
- The right side shows the requested intentional changes: recognizable Google G, white logo tile, Google-blue outline/tint, and stronger action hierarchy.
- Copy, radius, height, placement, neighboring status badge, and the surrounding dark surface remain consistent with the source.

## Comparison history

### Iteration 1 — preserve a visible outline

- Earlier finding `[P2]`: Nuxt UI's outline button uses a ring-based shadow, while the custom brand shadow replaced that ring and could leave the border visually weak.
- Fix: added an explicit one-pixel Google-blue mixed border and retained separate hover and focus states.
- Post-fix evidence: computed styles report a real one-pixel border in both themes, and the final focused comparison shows a continuous outline without changing the surrounding layout.

### Final visual pass

- The source and normalized implementation were inspected together in `google-business-profile-before-after.png`.
- The intentional brand differences are clear without overpowering the facility page; no additional visual correction was required.

## Functional verification

- Verified the Google asset loads successfully and reports complete intrinsic dimensions.
- Verified the button remains uniquely discoverable by the accessible name `Połącz z Google Business Profile`.
- Verified clicking it still opens the existing planned-integration notification and does not navigate away.
- Verified final dark-theme computed styles: `42`-pixel height, white text, blue-tinted dark surface, and one-pixel border.
- Verified light-theme computed styles: dark text, pale blue surface, and one-pixel blue-tinted border.
- Checked browser logs after the final render: no warnings or errors.
- CRM typecheck and `git diff --check` pass.

## Open questions

- None for the requested visual scope. The actual Google connection flow remains intentionally marked as planned functionality.

## Implementation checklist

- [x] Replace the generic icon with a recognizable Google logo.
- [x] Add Google-aware color styling without breaking the CRM design system.
- [x] Preserve existing copy, layout, and click behavior.
- [x] Verify dark and light themes.
- [x] Verify visual comparison, browser logs, types, and formatting.

final result: passed

---

# Design QA — status spotkania w kalendarzu

## Evidence

- Source visual truth: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-7f0d1a5e-0ea8-42b5-89c1-65ee99e11376.png`
- Browser-rendered implementation: `/private/tmp/openexpert-design-qa/calendar-status-after-final-exact.png`
- Normalized source: `/private/tmp/openexpert-design-qa/calendar-status-source-normalized.png`
- Focused side-by-side comparison: `/private/tmp/openexpert-design-qa/calendar-status-comparison.png`
- Responsive implementation: `/private/tmp/openexpert-design-qa/calendar-status-mobile.png`
- Local route: `http://127.0.0.1:3004/org/openexpert-local/calendar`
- Source dimensions: `1268 × 1388` pixels, normalized from DPR 2 to `634 × 694` pixels.
- Implementation viewport and pixels: `634 × 694` CSS pixels at DPR 1, captured as `634 × 694` pixels.
- Responsive viewport and pixels: `390 × 700` CSS pixels at DPR 1, captured as `390 × 700` pixels.
- State: authenticated local administrator, dark theme, Jan Kowalski appointment detail modal open, confirmed appointment.

## Findings

No actionable P0, P1, or P2 findings remain.

- **Fonts and typography:** the status uses the existing compact Nuxt UI badge typography. The full label remains visible and is no longer clipped.
- **Spacing and layout rhythm:** the appointment summary uses an explicit three-column grid, so the date occupies the flexible track and the status keeps its intrinsic width. At the mobile breakpoint the status moves below the date without horizontal overflow.
- **Colors and visual tokens:** the badge uses the semantic `success` color and `soft` variant, matching the existing dark-theme tokens while reading as status rather than an action.
- **Image quality and asset fidelity:** this component contains no raster assets. The status uses the installed Lucide circle-check icon; no custom SVG, CSS illustration, emoji, or placeholder asset was introduced.
- **Copy and content:** `Potwierdzone` is preserved as the appointment-state label and paired with a check icon for faster recognition.
- **Accessibility:** the status remains visible text in the DOM; the icon is decorative and hidden from assistive technology by the icon component.
- **Responsive behavior:** at `390 × 700`, the dialog remains within the viewport, the status is `92.7 × 20` CSS pixels, and the document has no horizontal overflow.

## Focused comparison evidence

- The normalized side-by-side comparison shows the broken `38 × 38` clipped square in the source and the corrected `92.7 × 20` status pill in the implementation.
- The modal content, appointment data, actions, typography, and surrounding layout remain otherwise unchanged.
- A separate mobile capture confirms the badge wraps to a dedicated row under the date without colliding with the icon or appointment metadata.

## Comparison history

### Iteration 1 — prevent flex shrinking

- Earlier finding `[P1]`: the status collapsed into a square and clipped most of `Potwierdzone`.
- Initial fix: replaced the flexible hero row with an explicit grid, prevented status wrapping, and added a semantic status icon.
- Post-fix evidence: the badge still measured `38 × 38`, revealing that layout shrinking was not the only cause.

### Iteration 2 — use the badge label contract

- Earlier finding `[P1]`: passing text through the default slot together with an icon allowed Nuxt UI to infer an icon-only badge.
- Fix: passed the status through the `label` prop and retained the semantic icon.
- Post-fix evidence: runtime DOM exposed the label slot correctly, but the badge still inherited the icon-container dimensions.

### Iteration 3 — scope icon-container styles

- Earlier finding `[P1]`: `.appointment-detail__hero > span` styled every direct span, including the rendered `UBadge` root, forcing `width: 38px; height: 38px`.
- Fix: added `.appointment-detail__icon` to the calendar icon wrapper and scoped fixed dimensions only to that class.
- Post-fix evidence: the final browser capture and measured DOM show a `92.7 × 20` badge with full text, correct color, and no overflow.

## Functional verification

- Opened the real Jan Kowalski appointment from the seeded calendar.
- Verified confirmed, pending, and cancelled states retain their existing label/color mapping in code.
- Verified the final desktop-equivalent state at `634 × 694` and responsive state at `390 × 700`.
- Checked browser console errors after the final render: none.
- CRM typecheck and `git diff --check` pass.

## Open questions

- None for the requested scope.

## Implementation checklist

- [x] Stop the status from inheriting fixed icon dimensions.
- [x] Use the Nuxt UI badge label contract.
- [x] Add a semantic status icon.
- [x] Keep the status readable in desktop and mobile modal layouts.
- [x] Verify the real appointment state, browser logs, types, and visual comparison.

final result: passed

---

# Design QA — karta klienta CRM

## Evidence

- Source visual truth: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-d75c2c8d-4a42-44a1-bc98-633e988aca39.png`
- Browser-rendered overview: `/private/tmp/client-detail-redesign-2262x1546.png`
- Browser-rendered history: `/private/tmp/client-detail-history-2262x1546.png`
- Browser-rendered mobile state: `/private/tmp/client-detail-mobile-390x844.png`
- Focused before/after comparison: `/private/tmp/client-detail-before-after-2262x1546.png`
- Local route: `http://127.0.0.1:3004/org/openexpert-local-04b35ead/clients/aa14d03a-2ec4-4f21-ba12-0ee5ae160c8b`
- Desktop viewport and implementation pixels: `2262 × 1546` CSS pixels at DPR 1, captured as `2262 × 1546` pixels.
- Source dimensions: `2262 × 1546` pixels. Its CSS viewport and density metadata are unavailable, so the comparison aligns equal pixel dimensions and treats the source as the documented pre-redesign state rather than a pixel-fidelity target.
- Mobile viewport and implementation pixels: `390 × 844` CSS pixels at DPR 1, captured as `390 × 844` pixels.
- State: authenticated organization administrator, dark theme, collapsed desktop sidebar, real Jan Kowalski demo record.

## Findings

No actionable P0, P1, or P2 findings remain.

- **Information architecture:** the dominant permanent “Nowa sprawa” form and long consent stack were replaced by five route-backed views: `Podsumowanie`, `Sprawy`, `Zgody`, `Wizyty`, and `Historia`. The new hierarchy keeps the client identity and primary action stable while each data domain gets a focused workspace.
- **Fonts and typography:** heading scale, mono eyebrows, metadata, badges, body copy, and compact labels reuse the existing OpenExpert tokens. The page retains the same display/body family as the source while introducing a clearer type hierarchy inside metrics and panels.
- **Spacing and layout rhythm:** the source's large empty right column and vertically unbounded card stack are removed. The implementation uses a consistent 12/18/22/26-pixel rhythm, aligned metric cards, balanced overview columns, and the shared PageHeader tabs on the bottom edge.
- **Colors and visual tokens:** all surfaces, borders, text, states, and timeline tones use semantic Nuxt UI/OpenExpert tokens. The dark palette remains visually consistent with the source and neighboring CRM detail pages.
- **Image quality and asset fidelity:** this screen contains no photographic or illustrative assets. It reuses the existing application logo and Lucide icon collection; no emoji, placeholder imagery, handcrafted SVG, CSS illustration, or fake asset was introduced.
- **Copy and content:** headings describe user goals rather than storage structures. Counts and labels come from real API data, and the History feed combines real CRM activity, related-case activity, consent events, dates, and actor names.
- **Responsive behavior:** at `390 × 844`, the PageHeader actions fit on one row, tab navigation remains horizontally scrollable, content collapses to one column, and no horizontal document overflow is visible.
- **Accessibility:** the page has one H1, labelled regions, route-backed links, visible active tab state, semantic `dl` content, timeline dates, keyboard-operable buttons, and labelled modals.

## Focused comparison evidence

- **Header:** the combined comparison shows that client identity remains prominent, while status, owner, last update, tabs, and actions now form one reusable CRM PageHeader rather than disconnected content.
- **Primary workspace:** the comparison shows the permanent creation form removed from the reading flow. Summary metrics, contact data, relationship context, and recent activity now occupy aligned, scan-friendly regions.
- **History:** a separate browser capture verifies a full chronological feed with four real events and source counts, replacing the small source “Timeline” card.
- **Mobile:** the focused mobile capture verifies the header, three actions, scrollable tabs, and empty appointment state without desktop-only fixed columns.

## Comparison history

### Iteration 1 — final redesign pass

- No P0/P1/P2 mismatch was found after aligning the source and implementation to `2262 × 1546` pixels.
- The visual differences are intentional product improvements requested by the user: shared PageHeader, route-backed tabs, reduced form dominance, and a complete History surface.
- No visual fix loop was required after the first browser-rendered comparison.

## Functional verification

- Verified all five tabs navigate to distinct, shareable query states.
- Verified the History view renders one CRM activity plus three consent decisions from the local database, including the organization-scoped actor.
- Verified `Nowa sprawa` opens a modal with the current client preassigned; no record was created during QA.
- Verified the overflow menu opens the populated client edit form; no customer data was changed during QA.
- Verified the desktop overview, desktop History, and mobile appointment state.
- Checked browser logs after the interaction pass: no warnings or errors.
- CRM typecheck and `git diff --check` pass.

## Open questions

- A future unified cursor endpoint could paginate activities, consent events, and appointments as one feed. The current redesign intentionally uses the existing bounded API payload.

## Implementation checklist

- [x] Use the shared CRM PageHeader with back navigation, metadata, bottom tabs, and right-side actions.
- [x] Move “Nowa sprawa” into a modal action.
- [x] Add focused views for summary, cases, consents, appointments, and history.
- [x] Build History from real CRM and consent events.
- [x] Include activity from related cases and organization-scoped actors.
- [x] Verify desktop, mobile, primary actions, browser logs, types, and visual quality.

final result: passed

---

# Design QA — delegowanie zadania z umówieniem godziny

## Evidence

- Delegation source visual truth: `/Users/konradstraszewski/.codex/generated_images/019f9b03-9123-7252-ad7f-232fe77204fb/call_muFG5FbKqTM0qwZ2lT5zeFrl.png`
- Scheduling source visual truth: `/Users/konradstraszewski/.codex/generated_images/019f9a70-5c4c-7331-af6b-724f57a1e629/call_VWrFyIJVHSGAhCYZUAIFT1s4.png`
- Delegation comparison: `/private/tmp/openexpert-delegation-appointment-qa/delegation-step2-comparison.png`
- Scheduling comparison: `/private/tmp/openexpert-delegation-appointment-qa/booking-step3-comparison.png`
- Desktop result: `/private/tmp/openexpert-delegation-appointment-qa/delegation-panel-after-create-1488x1058.png`
- Mobile task list: `/private/tmp/openexpert-delegation-appointment-qa/delegation-panel-mobile-390x844.png`
- Mobile scheduling step: `/private/tmp/openexpert-delegation-appointment-qa/delegation-step3-mobile-390x844.png`
- Local route: `http://127.0.0.1:3004/org/openexpert-local/cases/6a3a86c3-4081-5480-b849-0c13c3caeb71?view=delegations`
- Desktop source and implementation captures are both `1488 × 1058` pixels at DPR 1.
- Mobile captures use a `390 × 844` CSS-pixel viewport at DPR 1.
- State: authenticated local organization administrator, dark theme, real seeded case, real assignee availability, and a task created with a confirmed appointment.

## Findings

No visual P0 finding remains. The subsequent lifecycle and integrity audit identified known P1 follow-ups documented below.

- **Information architecture:** the three-step flow keeps task definition, assignee choice, and timing/context separate. The final step makes booking a concrete hour the default while preserving a deadline-only option.
- **Component reuse:** the availability grid is the shared `BookingWeekPicker` used by the appointment flow. Week navigation, availability counts, time cells, selected state, empty state, retry behavior, and responsive day navigation retain one interaction language.
- **Delegation context:** recent assignees are surfaced before the full team list, and the case, clients, selected assignee, task title, meeting context, duration, and shared data scopes remain visible before submission.
- **Feedback and recovery:** loading, empty, error, slot-conflict, selected-hour, and success states have explicit copy and actions. A lost slot clears the stale selection and refreshes availability.
- **Typography, spacing, and color:** the modal follows the source hierarchy and existing CRM tokens. Green is reserved for selection, availability, progress, and the primary action; neutral surfaces and borders preserve the surrounding product language.
- **Responsive behavior:** at `390 × 844`, the modal becomes a contained mobile workspace, days are horizontally navigable, the action footer remains reachable, and the document has no horizontal overflow.
- **Accessibility:** steps, buttons, labels, availability states, meeting summary, and locked required scopes remain textually identifiable. The custom radio-style choices still require arrow-key behavior and roving tabindex.

## Focused comparison evidence

- The delegation comparison keeps the source's wide modal, three-step progress, recent-assignee shortcut, searchable team, persistent task summary, and anchored navigation.
- The scheduling comparison shows that the delegated-task flow now uses the same seven-day availability grammar as direct booking: dated columns, time rows, availability counts, empty days, and a strong selected-slot state.
- Desktop and mobile post-submit captures confirm that the new appointment is visible from the delegated task together with status, assignee, meeting time, and history.

## Comparison history

### Iteration 1 — shared scheduling and complete task context

- The first implementation pass reused the shared week picker and connected it to real assignee availability.
- Browser QA confirmed the desktop hierarchy and exposed no visual blocker.

### Iteration 2 — mobile containment and accurate access copy

- The scheduling step was verified at `390 × 844`; no document-level overflow was found.
- The context wording was tightened so it describes data attached to the delegated task without implying a separate access-control system.

## Scenario regression audit — 26 July 2026

- Completed tasks can currently be cancelled. The verified sequence `create → accept → done → cancel` returned `201 → 200 → 200 → 200`, changed the task from `done` to `cancelled`, and cleared `completed_at`.
- An authenticated delegator can directly rewrite `created_at`, `delegated_at`, `accepted_at`, and `responded_at` without creating an audit entry. Direct changes to `completed_at` and the work status remain correctly blocked.
- A deadline-only delegation with `due_at` three days in the past was accepted with HTTP `201` and persisted as `pending/open`. A past appointment slot is correctly rejected with a full rollback.
- Custom `role="radio"` groups do not change selection with arrow keys and place every option in the Tab order.
- Delegation status is refreshed after local actions, but there is no live subscription, polling, stale-state indicator, or manual refresh for changes made by the other participant.
- Reassignment is enforced and audited by the database, but is not exposed in the UI and does not book a replacement appointment.
- The meeting model does not yet record `completed`, `no_show`, or an outcome, so the case cannot answer whether the linked meeting actually happened.
- The focused unit suite passed `20/20`; CRM typecheck, the authenticated API smoke suite, and database verification passed.
- All temporary tasks, appointments, activities, and idempotency rows were removed after the audit. Database verification finished with six tasks, two linked task meetings, eight appointments, and 25 free slots.

## Functional verification

- Delegated `Umów konsultację nieruchomościową` to Anna Nowak from the recent-assignee section.
- Loaded seven days of the selected expert's real availability and selected `27 lipca 2026, 09:00`.
- Created the delegated task and confirmed appointment in one atomic operation.
- Verified the resulting task card shows pending status, assignee, confirmed meeting, and audit history.
- Verified deadline-only delegation remains available.
- Verified conflict recovery, idempotent replay, cancellation, rejection, reassignment, audit logging, slot release, and permission guards through the API smoke suite.
- Verified the current seed contains six delegated tasks, two linked delegated-task meetings, eight appointments, and 25 free slots.
- Checked browser warnings and errors after the final interaction pass: none.
- CRM test suite, typecheck, production build, database reset, seed verification, and API smoke suite pass.

## Open questions

- Should cancelling a completed task be forbidden, or represented by a separate audited “reopen/withdraw completion” action?
- Which system timestamps may be corrected administratively, and what correction audit event should be recorded?
- Should every delegated task require a future deadline and the `case_summary` scope at the API/database boundary?
- Should reassignment require choosing a new appointment immediately when the previous assignee had a linked meeting?
- Which meeting outcomes and follow-up fields are required for delegation oversight?

## Implementation checklist

- [x] Rename the action and flow to `Deleguj zadanie`.
- [x] Show recent assignees and the full searchable team.
- [x] Reuse the shared booking-hour component.
- [x] Load real availability for the selected expert.
- [x] Create the task and appointment atomically.
- [x] Keep status, meetings, and complete task history visible on the case.
- [x] Add representative delegated tasks and a linked meeting to the seed.
- [x] Verify desktop, mobile, browser logs, database constraints, types, build, and automated tests.

final result: passed with known P1 follow-up

---

# Design QA — katalog i podstrona placówki z Mapbox

## Evidence

- Source visual truth — katalog: `/Users/konradstraszewski/.codex/generated_images/019f9bc0-9451-7a10-8df5-a3cc570b1a76/call_A1ytgKZgDGTmMgA9AINWj3Eu.png`
- Source visual truth — podstrona placówki: `/Users/konradstraszewski/.codex/generated_images/019f9bc0-9451-7a10-8df5-a3cc570b1a76/call_7hbts4eLpo7e3H0SkoVTrnsa.png`
- Browser-rendered implementation screenshot: unavailable — the in-app browser refused navigation to the local preview during the required QA capture.
- Intended local routes: `http://127.0.0.1:3003/placowki` and `http://127.0.0.1:3003/placowki/openexpert-local/szczecin-centrum`
- Intended comparison viewport: `1487 × 1058` CSS pixels at DPR 1.
- Source image dimensions: both references are `1487 × 1058` pixels.
- Implementation pixel dimensions, CSS size, and density normalization: unavailable because no browser-rendered capture could be produced.
- State: public local demo with one published facility, real seeded gallery, four services, four experts, five opening-hour ranges, and Mapbox coordinates.

## Findings

- **[P0] Required browser-rendered comparison evidence is missing**
  - Location: catalog and public facility detail page.
  - Evidence: both selected source visuals opened successfully, but the browser rejected navigation to the local preview before an implementation screenshot, console log pass, or interaction pass could be captured.
  - Impact: typography, spacing, colors, image crop, popup placement, responsive layout, and visual polish cannot be truthfully passed from code and API evidence alone.
  - Fix: allow the in-app browser to open the local preview, capture both routes at `1487 × 1058` and mobile `390 × 844`, combine each implementation capture with its matching source visual, fix any P0/P1/P2 drift, and repeat the comparison.

## Required fidelity surfaces

- **Fonts and typography:** implemented with existing OpenExpert DM Sans and mono tokens, but visual weight, wrapping, and optical hierarchy remain unverified.
- **Spacing and layout rhythm:** the selected list/map split, detail gallery/summary split, sticky map rail, borders, and responsive breakpoints are implemented, but the rendered proportions remain unverified.
- **Colors and visual tokens:** the neutral black/white palette and existing OpenExpert tokens are used; rendered Mapbox basemap balance and contrast remain unverified.
- **Image quality and asset fidelity:** the real three-image seeded facility gallery and stored alt text are used; final crop, sharpness, and thumbnail rhythm remain unverified.
- **Copy and content:** Polish catalog, contact, service, expert, opening-hours, directions, sharing, and booking copy is present and driven by the public API.
- **Accessibility:** semantic headings, breadcrumbs, address/contact links, keyboard-operable map markers, map attribution, search, mobile list/map controls, gallery dialog, focus states, and reduced-motion handling are implemented; browser keyboard verification remains outstanding.

## Full-view and focused comparison evidence

- Full-view comparison: blocked because no implementation screenshot is available.
- Focused region comparison: blocked for the same reason. Required future regions are the catalog list/map seam and popup, the detail gallery/summary grid, and the sticky location/booking rail.
- No side-by-side comparison artifact was created; separate source inspection is not being represented as a valid comparison.

## Comparison history

- No visual iteration can be counted. Build, API, typecheck, and route smoke checks do not satisfy the design-QA comparison requirement.
- After the user explicitly approved opening the local catalog for QA, the in-app browser still refused navigation to the preview. No alternative browser surface was used, so the evidence requirement remains blocked.

## Functional verification completed outside browser QA

- Public directory API returns one facility with stable organization/facility slugs, city, address, cover image, and valid WGS84 coordinates.
- Public detail API returns contact data, five opening-hour ranges, three gallery images, four services, and four experts.
- The public detail endpoint returns `404` unless the facility is active and backed by an active, directory-listed calendar widget with a valid bookable catalog.
- Landing tests pass `40/40`.
- Landing typecheck passes.
- Production build passes.
- Database verification, migration checks, SQL constraints, and the seeded-coordinate assertion pass.
- Primary browser interactions tested: none; browser navigation was blocked before the page opened.
- Console errors checked: unavailable; browser navigation was blocked before the page opened.

## Implementation checklist

- [x] Add WGS84 coordinates with pair and range constraints.
- [x] Seed the Szczecin facility coordinates.
- [x] Add Mapbox GL JS with a local ignored public token and documented environment placeholder.
- [x] Build the responsive list/map catalog.
- [x] Add canonical `/placowki/:organizationSlug/:facilitySlug` routes.
- [x] Add a gated public facility-detail API.
- [x] Build gallery, services, experts, contact, directions, opening hours, sharing, map, and booking rail.
- [x] Add facility URLs to the dynamic sitemap and structured data.
- [x] Pass automated tests, typecheck, build, API smoke, and database verification.
- [ ] Capture and compare the browser-rendered desktop and mobile states.
- [ ] Check browser console and primary interactions.
- [ ] Fix any visual P0/P1/P2 findings and repeat the comparison.

final result: blocked
