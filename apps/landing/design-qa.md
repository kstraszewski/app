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
