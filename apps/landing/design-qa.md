# Landing page redesign — design QA

## Scope

- Product: OpenExpert landing page
- Core promise: one expert leads one client case through real estate, mortgage financing, and insurance.
- Required behavior: responsive layout, working navigation, mobile menu, and waitlist validation.

## Visual sources

- Desktop source, 1536×1024: [`design/landing-one-case-desktop.png`](design/landing-one-case-desktop.png)
- Mobile source, 390×844 equivalent: [`design/landing-one-case-mobile.png`](design/landing-one-case-mobile.png)
- Desktop implementation, 1536×1024: [`design/qa-desktop-1536x1024-final.jpg`](design/qa-desktop-1536x1024-final.jpg)
- Mobile implementation, 390×844: [`design/qa-mobile-390x844-final.jpg`](design/qa-mobile-390x844-final.jpg)

## Same-input comparisons

- Full desktop viewport: [`design/qa-compare-desktop-full.jpg`](design/qa-compare-desktop-full.jpg)
- Focused desktop hero: [`design/qa-compare-desktop-hero.jpg`](design/qa-compare-desktop-hero.jpg)
- Full mobile viewport: [`design/qa-compare-mobile-full.jpg`](design/qa-compare-mobile-full.jpg)

## Responsive checks

| Viewport | Result |
| --- | --- |
| 1536×1024 | Two-column hero, 747 px case panel, matching 661 px dark-shell boundary, no horizontal overflow. |
| 768×1024 | Hero content and case panel stack cleanly; desktop navigation remains usable; no horizontal overflow. |
| 390×844 | Mobile menu replaces desktop navigation; two CTAs remain side-by-side; case card starts at 422 px and matches the source composition; no horizontal overflow. |
| 320×720 | CTAs stack into full-width rows; headline and case data stay within the viewport; `scrollWidth === clientWidth === 320`. |

## Behavior and accessibility

- Mobile menu opens and closes with one accessible button; `aria-expanded` and the button label update between “Otwórz menu” and “Zamknij menu”.
- The “Platforma” navigation link resolves to `#platforma`; the section lands 88 px below the viewport edge, matching the sticky-scroll offset.
- Empty waitlist submission focuses the email input and renders “Podaj poprawny adres e-mail.” without making a network request.
- Page landmarks, heading hierarchy, named navigation regions, form labels, and button/link accessible names are present in the browser accessibility snapshot.
- No application runtime errors were observed. The dev page logs only Vite HMR WebSocket connection errors caused by the project’s intentionally disabled HMR setting; production build is unaffected.

## Comparison history

1. Initial implementation: desktop geometry was close, but the mobile card began about 75 px below the source, the mobile card logo was missing, the display serif was too condensed, and the light journey section started too low.
2. Mobile correction: reduced header/hero spacing, tightened lead copy, aligned the CTA/card transition, and restored the mobile card logo and internal header rhythm.
3. Typography and desktop correction: matched headline line lengths with a wider italic serif, aligned the hero boundary to 661 px, and corrected the journey heading, steps, and mantra positions.
4. Final side-by-side review: typography, spacing, panel geometry, colors, borders, iconography, copy hierarchy, and responsive behavior match the selected direction with no remaining P0, P1, or P2 findings.

## Automated verification

- `pnpm --filter @openexpert/landing typecheck` — passed.
- `pnpm --filter @openexpert/landing test:pdf` — 13/13 passed.
- `pnpm --filter @openexpert/landing build` — passed.
- `git diff --check -- apps/landing pnpm-lock.yaml` — passed.
- Environment note: the repository requests Node 24.x; verification ran successfully on Node 22.22.0 with a non-blocking engine warning.

final result: passed

---

# Personalizacja — RWD regression fix

## Comparison target

- Source visual truth 1: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-a2b5916f-ed82-44ef-bbed-b48c3d9affa8.png`
- Source 1 pixels: `672 × 1188`; normalized to `336 × 593` for a `336 × 593` CSS viewport at `deviceScaleFactor: 1`.
- Implementation 1: [`design/personalization/personalization-rwd-final-336.jpg`](design/personalization/personalization-rwd-final-336.jpg), `336 × 593`.
- Same-input comparison 1: [`design/personalization/personalization-rwd-comparison.png`](design/personalization/personalization-rwd-comparison.png), `672 × 593`, source on the left and implementation on the right.
- Source visual truth 2: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-a16091b1-8f31-4308-9c7b-93913bb070ed.png`
- Source 2 pixels: `724 × 1210`; normalized to `362 × 605` for a `362 × 605` CSS viewport at `deviceScaleFactor: 1`.
- Implementation 2: [`design/personalization/personalization-home-rwd-final-362.jpg`](design/personalization/personalization-home-rwd-final-362.jpg), `362 × 605`.
- Same-input comparison 2: [`design/personalization/personalization-home-rwd-comparison.png`](design/personalization/personalization-home-rwd-comparison.png), `724 × 605`, source on the left and implementation on the right.
- Routes and states:
  - `/personalizacja`, Ocean selected, mobile `Podgląd` tab active.
  - `/#personalizuj`, Ocean selected, compact landing preview visible.

## Full-view and focused comparison evidence

Comparison 1 is both the full mobile viewport and the focused failing region. Before the fix, the hidden rail left its `70 px` desktop grid track active, forcing the case body and CTA into a narrow column. After the fix, the case root switches to a single block column: the card measures `258 px`, its body `256 px`, and the CTA `216 px` at the `336 px` viewport. The title, people, agent activity and bottom navigation now use the intended compact hierarchy.

Comparison 2 focuses on the landing preview. The clipped `3 ag…` status is replaced with a deliberate `34 px` icon chip. Its `14 px` existing Iconify/Lucide bot remains visible, while the full `3 agentów aktywnych` label stays available to assistive technology.

## Required fidelity surfaces

- Fonts and typography: no font family, weight, size, line-height or letter-spacing tokens changed. The fix removes accidental one-word wrapping in the case preview and preserves the existing title, metadata and ellipsis hierarchy.
- Spacing and layout rhythm: the compact case now uses its full container width and the existing mobile padding. Named container queries switch the landing preview at its own `560 px` width instead of depending on the viewport. No horizontal overflow was measured at `336`, `390`, `560`, `640`, `641`, `672`, `768`, `820` or `960 px`.
- Colors and visual tokens: Ocean, Ember and Plum theme variables are unchanged. Borders, surfaces, shadows, radii and state colors remain product-owned.
- Image quality and asset fidelity: existing OpenExpert logo assets and the installed Iconify/Lucide icons remain in use. No raster placeholder, handmade SVG, CSS drawing or replacement asset was introduced.
- Copy and content: all case, client, expert and activity copy is unchanged. The compact agent label is visually hidden rather than removed from the accessibility tree.

## Findings and comparison history

### Pass 1

- P1 — `/personalizacja` combined mobile descendants with a desktop root grid. The self-querying `.theme-case` could not apply `display: block`, while its rail was hidden, leaving the body in the `70 px` rail column.
  - Fix: added a named `theme-case-preview` wrapper container and moved the container query responsibility off the element being restyled.
  - Post-fix evidence: comparison 1 shows a full-width case column, full-width CTA, readable people/activity sections and no page overflow.
- P1 — the landing preview intentionally clipped a full status label with `max-width` and `overflow`, leaving the visible fragment `3 ag…`.
  - Fix: wrapped the label separately, retained it for accessibility, and rendered a centered existing bot icon in the compact `34 px` chip.
  - Post-fix evidence: comparison 2 shows a stable icon-only chip with no clipped characters.
- P2 — landing compact behavior used a viewport media query even though the component is nested in a variable-width panel.
  - Fix: changed the compact rules to a named `personalization-demo` container query.
  - Post-fix evidence: the full variant remains active at a `578 px` component width and the compact variant activates at `559 px`.

### Pass 2

- No actionable P0/P1/P2 differences remain. The second pass caught and fixed an intermediate selector that visually hid the Iconify span together with the label; the final selector targets only `.personalization-demo__agent-state-label`, and the icon measures `14 × 14 px`.

## Interaction, responsive and automated verification

- Mobile `Ustawienia` / `Podgląd` switching was exercised and the pressed state updated correctly.
- Theme selection was exercised on the landing preview; Ocean, automatic cycling and the pause control remained functional.
- `/personalizacja` retained its desktop grid and visible rail at `1440 px`.
- The page `scrollWidth` equalled `clientWidth` at every checked breakpoint.
- Final browser-rendered captures were inspected together with both normalized sources.
- In-app browser logging was checked. It contained module-loader instrumentation messages, with no visible application overlay or source-component runtime failure; the final production Nuxt build and production-rendered responsive measurements passed.
- `pnpm --filter @openexpert/landing test` — `40/40` passed.
- `pnpm --filter @openexpert/landing typecheck` — passed.
- `pnpm --filter @openexpert/landing build` — passed.
- `git diff --check -- apps/landing/app/components/personalization/CasePreview.vue apps/landing/app/components/landing/PersonalizationPreview.vue apps/landing/design-qa.md` — passed.

## Follow-up polish

- No P3 visual follow-up is required for this regression.

final result: passed

---

# Design QA — `/placowki` search focus

## Comparison target

- Source visual truth: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-ffb1ff8e-4374-465c-8a8b-1c8ab6154366.png`, 940 × 224 px.
- Browser-rendered full view after the fix: `.design-qa/focus-after-viewport.png`, 919 × 863 px.
- Focused before crop: `.design-qa/focus-double-border-before.png`, 480 × 96 px.
- Focused after crop: `.design-qa/focus-single-border-after.png`, 480 × 96 px.
- Same-input comparison, before on the left and after on the right: `.design-qa/focus-border-comparison.png`, 960 × 96 px.
- Route and state: `http://127.0.0.1:3003/placowki`, search input focused, one published facility.

## Capture normalization

- Both browser comparison states used the same 919 × 863 CSS px viewport at device scale factor 1.
- In both states the search wrapper measured 449 × 64 CSS px at the same position.
- Both focused crops use the same 480 × 96 px crop and were placed together without scaling.
- The source attachment is a higher-density crop of the same focused control; the browser before/after pair is the density-normalized evidence used for the final judgment.

## Evidence and findings

- P2 — The input received its own 2 px `outline` while the wrapper simultaneously rendered its border and focus ring. This produced the two internal vertical lines visible in the source and the left side of the comparison.
- Fix — The wrapper ring now responds specifically to `input:focus-visible`, while the input suppresses its duplicate outline. Focus remains clearly visible around the complete search control.
- The clear button keeps its independent button focus treatment and no longer causes the wrapper input ring through a generic `:focus-within` state.
- Full-view inspection confirms the search placement, size, radius, typography, map context, result count, and surrounding layout are unchanged.

### Required fidelity surfaces

- Fonts and typography: unchanged; placeholder family, size, line height, weight, and wrapping match the pre-fix control.
- Spacing and layout rhythm: unchanged; the 449 × 64 px control geometry, padding, dividers, radius, shadow, and position are stable.
- Colors and visual tokens: the existing black focus token and neutral border/shadow tokens remain in use.
- Image quality and asset fidelity: no image or icon assets were changed; the existing search icon remains intact.
- Copy and content: placeholder and result-count copy are unchanged.

## Interaction and technical verification

- Clicking the text input produces one focus treatment around the complete control.
- Entering `Szczecin` updates the search and exposes the clear control; activating clear resets the value.
- Browser console check returned no warnings or errors.
- `pnpm --filter @openexpert/landing typecheck` — passed on Node 24.
- `pnpm --filter @openexpert/landing test` — 40 passed, 0 failed.
- `git diff --check` for the edited page and QA artifacts — passed.

No actionable P0, P1, or P2 findings remain in the focused search state.

final result: passed

---

# Landing personalizacja — animowany podgląd motywów

## Comparison target

- Source screenshot: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-99954778-10ef-4b9b-99fb-046031790375.png`, `1688 × 1352` pixels.
- Implementation capture: [`design/personalization/personalization-animation-implementation.jpg`](design/personalization/personalization-animation-implementation.jpg), `919 × 863` pixels.
- Same-input comparison, source on the left and implementation on the right: [`design/personalization/personalization-animation-comparison.jpg`](design/personalization/personalization-animation-comparison.jpg), `1820 × 850` pixels.
- Route and state: `http://127.0.0.1:3003/#personalizuj`, public landing, Plum selected and autoplay paused for a stable visual frame.

## Intentional redesign

The previous four-card preset catalogue was intentionally replaced with one realistic CRM proof. The layout remains fixed while Ocean, Ember, and Plum change the palette, font stack, surface treatment, and radii. Three compact named controls and a progress line explain the cycling without recreating the removed theme grid. The existing CTA to the full configurator remains directly below the live example.

## Visual review

- Typography: the neutral landing shell retains its current monospace and display hierarchy; the preview switches between DM Sans, Roboto, and Manrope with a stable content hierarchy.
- Layout and spacing: the mini CRM keeps a clear case heading, client state, next step, and agent activity in one compact panel. The result uses materially less explanatory chrome than the old grid and makes the customization claim visible rather than descriptive.
- Color and shape: Ocean, Ember, and Plum use the same preset tokens as `/personalizacja`, including their distinct `8 px`, `4 px`, and `24 px` card radii and matching control radii.
- Assets: the existing OpenExpert logo and the configured Lucide icon set are used; no placeholder or recreated brand asset was introduced.
- Responsive safety: at the in-app browser viewport (`919 × 863`) the page reports zero horizontal overflow. Below `560 px`, the component removes the sidebar and secondary next-step card, stacks the remaining agent card, and keeps the three controls full width.

## Interaction verification

- Autoplay advanced through all three themes and changed the rendered primary color, font family, and radius.
- Manual selection pauses autoplay; two rapid selections ended on the last requested theme, Plum.
- Pause held Plum for longer than the full `4.4 s` cycle. Resume restarted both the timer and progress line together; the measured progress moved from `6%` to `34%`, then the theme advanced to Ocean with the next progress run at `11%`.
- Hover and focus have independent pause state. The component also pauses outside the viewport and on a hidden browser tab.
- `prefers-reduced-motion` disables autoplay and animated transitions while retaining manual theme selection.
- Theme controls expose a labelled group and `aria-pressed`; pause/resume has a state-specific accessible name. Touch targets are at least `40 px` for pause and `44 px` for theme selection.
- Browser console errors: none.

## Verification

- `pnpm --filter @openexpert/landing test:pdf` — `18/18` passed.
- Node 24 production build — passed.
- `git diff --check -- apps/landing/app/pages/index.vue apps/landing/app/components/landing/PersonalizationPreview.vue` — passed.
- Repository-wide landing typecheck remains blocked by pre-existing errors in the unrelated multiform API files: `bundle/prepare.post.ts`, `demo-pdfs/[templateId].get.ts`, and `templates/generate.post.ts`. The production build contains the new component without component-level TypeScript or Vue compilation errors.

final result: passed

---

# Personalizacja CRM — design QA

## Comparison target

- Source visual truth: `/var/folders/m6/ync19sd96gz4pg73zt0mq_6m0000gn/T/codex-clipboard-93f56230-7df0-48ff-b830-b6ef967baf1c.png`
- Source pixels: `1674 × 1104`.
- Full desktop implementation: [`design/personalization/personalization-final-desktop.jpg`](design/personalization/personalization-final-desktop.jpg), `1159 × 1675` screenshot pixels.
- Focused implementation crop: [`design/personalization/personalization-case-final.jpg`](design/personalization/personalization-case-final.jpg), `1068 × 720` pixels.
- Compact implementation: [`design/personalization/personalization-mobile.jpg`](design/personalization/personalization-mobile.jpg), `919 × 1427` screenshot pixels.
- Same-input comparison: [`design/personalization/personalization-design-qa-comparison.jpg`](design/personalization/personalization-design-qa-comparison.jpg).
- Route: `http://127.0.0.1:3003/personalizacja`.
- State: public route, Ocean preset selected, no authentication, live case preview visible.

## Density and normalization

The focused source and implementation were placed in one comparison canvas after both were normalized to `720 px` height. The source became `1092 × 720`; the implementation remained `1068 × 720`. This preserves both aspect ratios and makes the component geometry directly comparable without browser chrome. The full desktop and compact captures were also inspected independently.

## Full-view comparison evidence

- The page adds a neutral OpenExpert configuration shell around the selected case component, with theme selection on the left and the live CRM preview on the right.
- At desktop width, the preview preserves the source hierarchy: narrow application rail, case heading, client/expert pair, agent activity band, and three connected work stages.
- At the compact breakpoint, the page switches to the explicit `Ustawienia / Podgląd` control, keeps four theme cards in a usable 2×2 grid, and has no visible horizontal clipping.

## Focused comparison evidence

The side-by-side component comparison shows that the implementation retains the reference proportions and information architecture. The switch from black to the Ocean blue/white palette, the neutral font stack, rounded geometry, added status badges, and removal of the unrelated mascot are intentional consequences of the personalization demo rather than fidelity drift.

### Required fidelity surfaces

- Fonts and typography: display/body stacks switch with each preset; Ocean uses DM Sans, Ember uses Roboto, and Plum uses the open Manrope family. Weight, hierarchy, wrapping, and small metadata remain legible in the focused comparison.
- Spacing and layout rhythm: rail width, header/people split, agent band, timeline alignment, row separators, and three-step cadence match the source. The intermediate breakpoint now gives the preview enough width before it enters the compact component layout.
- Colors and visual tokens: all case colors are driven by scoped CSS variables. Ocean, Ember, and Plum are neutral, product-owned starting points; the control shell stays neutral and readable.
- Image quality and asset fidelity: the existing OpenExpert logo asset and configured Lucide icons are used. No placeholder, handmade SVG, emoji, or recreated raster asset replaces a visible source asset.
- Copy and content: the source case, people, agent workflow, and three work stages are retained. The case identifier and stage badges add realistic CRM context without changing the scenario.

## Findings and comparison history

1. Initial desktop pass — P2: at the in-app browser's `1280 px` width, the fixed `410 px` controls column left the case preview too narrow and close to square compared with the source.
   - Fix: from `961–1320 px`, controls and preview now stack at full width; the theme cards become a four-column row. The focused case then measures about `1126 × 720`, closely matching the source aspect ratio.
   - Post-fix evidence: the final desktop and focused comparison captures above show the corrected width, full agent strip, visible stage statuses, and no clipped content.
2. Interaction pass — no P0/P1/P2 finding: all three presets update the primary color and font stack, Custom accepts a valid HEX value, font and radius changes update the preview, contrast feedback recalculates, and local save reports success.
3. Final visual pass — no actionable P0/P1/P2 finding remains across typography, spacing, colors, assets, copy, and responsive structure.

## Functional and accessibility verification

- Verified Ocean `#2563EB`, Ember `#C2410C`, and Plum `#9B0050` with its `#EF7F1A` accent in the rendered preview, together with their intended font stacks.
- Verified Custom creation from the active preset, live HEX editing, display-font selection, radius editing, WCAG contrast feedback, reset, and local save success state.
- Theme cards use a labelled radio group and a non-color selected mark; inputs, buttons, selects, and the mobile view switch are keyboard focusable.
- The production page produced no local console errors or warnings.
- `nuxt typecheck` passed.
- Node test suite passed: `18/18`.
- Production Nuxt build passed.
- `git diff --check -- apps/landing` passed.

## Follow-up polish

- All presets use fonts already available to the application or system, so the demo does not depend on licensed brand font files.

final result: passed

---

# Design QA — `/placowki`

## Scope

- Source visual truth: `.design-qa/reference-option-3.png`
- Final implementation: `.design-qa/implementation-desktop-final.png`
- Combined comparison: `.design-qa/comparison-desktop-final.png`
- Responsive evidence:
  - `.design-qa/implementation-mobile-list-final.png`
  - `.design-qa/implementation-mobile-map-final.png`
- Tested state: one published facility, selected by default, live Mapbox map loaded

## Capture normalization

- Source: 1448 × 1086 px
- Desktop implementation viewport: 1448 × 1086 CSS px
- Desktop implementation screenshot: 1448 × 1086 px
- Effective density: 1 screenshot pixel per CSS pixel
- Combined comparison: 2896 × 1086 px, source on the left and implementation on the right
- Mobile verification viewport and screenshots: 390 × 844 CSS px / px

## Final comparison

The final full-view comparison was inspected as one combined image. The implementation preserves the selected map-first composition: compact editorial intro, full map canvas, floating search, left results drawer, numbered selected marker, mid-map controls, and bottom selected-facility dock.

The implementation intentionally keeps the existing OpenExpert header, typography, real facility imagery, live Mapbox tiles, Lucide icon family, and current directory data. Differences in map labels and road density come from the live map renderer rather than replacement artwork.

Focused responsive inspection used the mobile list and mobile map screenshots. The mobile list has usable wrapping and tap targets. The mobile map exposes the selected facility dock immediately, keeps map controls reachable, and recenters after a breakpoint or orientation resize.

## Interaction verification

- Search query with no match produced the zero-results copy, `0 placówek`, and an empty map state.
- Search query `Szczecin` restored the facility, marker, selected state, and result count.
- Closing the drawer moved keyboard focus to `Pokaż listę placówek`; the hidden drawer became inert.
- Reopening the drawer moved focus to `Ukryj listę placówek`.
- Mobile `Lista` and `Mapa` tabs switched the visible surface and updated their pressed state.
- The mobile map retained a visible, linked selected-facility card instead of becoming a dead end.
- Numbering is consistent between the result list, marker, and selected-facility dock.
- The location control uses the browser geolocation API and reports progress or failure through the map live region.
- Final browser console check returned no warnings or errors.

## Motion and accessibility

- Entry motion covers the heading, map, search bar, drawer, and drawer restore control.
- Drawer open/close, selected-facility dock, selected card, marker, image, CTA arrow, focus, and hover states use short eased transitions.
- Map camera changes use non-essential easing and recalculate framing after resize.
- `prefers-reduced-motion: reduce` removes entry animations, transitions, hover transforms, marker scaling, camera duration, and the loading spinner animation.
- Search has a programmatic label and live result copy.
- Map markers are keyboard-accessible buttons with pressed state and descriptive labels.
- Drawer controls preserve focus order; hidden controls are inert.

## QA history

### Pass 1

- P1 — Intro copy inherited an old mono uppercase rule and drifted from the selected source.
- P1 — The marker was too small and its number was not visibly legible.
- P1 — The map camera ignored the left drawer and centered the selected location too far left.
- P2 — The selected source included a location control that was missing.
- Fixed by correcting selector specificity, matching the source intro grid and type scale, using a larger numbered Mapbox marker, adding overlay-aware camera padding, and adding a functional Lucide location control.

### Pass 2

- P0 — A duplicate `defineExpose()` macro caused a Vite runtime overlay.
- P1 — A visually hidden drawer remained keyboard-focusable.
- P1 — Mobile map mode hid both the list and the selected-facility CTA.
- P2 — Marker numbering could diverge from list numbering when a facility lacked coordinates.
- P2 — Reduced-motion coverage missed the drawer-close hover transform and loading spinner.
- Fixed by merging the exposed map API, adding inert state and focus transfer, adding the mobile selected-facility dock, deriving all numbers from the visible facility list, and extending reduced-motion rules.

### Pass 3

- P2 — Drawer content was denser than the selected source and the map framing remained slightly misaligned.
- Fixed by matching horizontal card padding, image height, CTA height and rhythm, fine-tuning map zoom, and aligning the selected marker with the source composition.

## Automated checks

- `pnpm --filter @openexpert/landing typecheck` — passed
- `pnpm --filter @openexpert/landing test` — 40 passed, 0 failed
- `git diff --check` for the two edited source files — passed

No actionable P0, P1, or P2 findings remain.

final result: passed
