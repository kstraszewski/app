# Client portal design QA

final result: passed

## Responsive QA — 2026-08-22

### Source, viewport and state

- User-supplied problem capture: `/tmp/codex-remote-attachments/01a028d2-f246-7d93-8719-69501692b98c/fb874385-696b-4fe9-825f-eedd994cae03/1-Photo-1.jpg` (`575 × 1280`).
- The source shows the desktop two-column login compressed into a mobile browser. It is treated as the defect report, not as the desired mobile composition.
- Corrected login capture: `apps/client/design-qa-login-mobile.jpg` (`576 × 1000`, DPR 1, demo enabled).
- Normalized source/implementation comparison: `apps/client/design-qa-login-comparison.jpg` (`1149 × 1000`). The source was cropped below the browser chrome to `575 × 1000`; the implementation was captured at `576 × 1000` and normalized to `574 × 1000` for the side-by-side comparison.
- Responsive fallback capture: `apps/client/design-qa-login-fallback-980.jpg` (`980 × 1234`, DPR 1).
- Mobile dashboard capture: `apps/client/design-qa-rwd-dashboard-mobile.jpg` (`390 × 844`, DPR 1).
- Browser: Codex in-app browser against `http://127.0.0.1:3016`.

### Full-view comparison evidence

- Layout and hierarchy: the broken compressed split view is replaced by one readable login column at `≤1024px`; the desktop story panel returns at `1025px`.
- Typography: the mobile heading renders at `32px`; labels and helper copy no longer inherit desktop downscaling.
- Color and contrast: the existing monochrome portal palette is preserved, including the black primary CTA and subtle bordered demo card.
- Components and icons: login tabs are `44px`, the text field is `48px`, and the primary CTA is `52px` high. Existing logo and Lucide icons are reused.
- Content: Polish login, demo and trust copy is unchanged; the improvement is structural and responsive.
- A separate focused crop was not required because the entire login form and footer fit in the corrected full-view capture.

### Responsive and interaction matrix

| Surface | Viewport | Result |
| --- | ---: | --- |
| Login | `320 × 1000` | One column, no horizontal overflow, 44/48/52px tab-input-CTA targets |
| Login | `576 × 1000` | One column, full demo row, footer visible, no horizontal overflow |
| Login fallback | `980 × 1280` | Centered 640px form; no compressed desktop split |
| Login desktop boundary | `1025px` wide | Two-column story/form layout restored |
| Dashboard | `390 × 844` | Single-column cards and fixed two-item mobile navigation |
| Dashboard | `980px` wide | Main action spans both columns; meeting and expert cards share the second row |
| Messages | `980px` wide | List/detail becomes a coordinated single-pane flow with working back navigation |
| Case detail | `980px` wide | Sidebar collapses into the top tab control |
| Multiwniosek | `390px` and `980px` wide | Single-column workspace; mobile-nav clearance prevents overlap |
| Meeting preparation | `390px` and `980px` wide | Single-column hero/workspace; horizontally scrollable step rail |

Password-tab switching, return to the magic-link tab, opening a message and returning to the inbox were exercised in the browser. The checked routes produced no browser console errors or warnings.

### Responsive iteration history

1. Reproduced the reported geometry as a `980px` desktop layout scaled into the `575px` device capture and confirmed that the current production document already includes a viewport meta tag.
2. Added an explicit viewport declaration and browser text-size normalization, then moved structural tablet breakpoints to `1024px` across authentication, dashboard, case, messages, account, Multiwniosek and meeting preparation.
3. The first small-screen pass exposed P2-sized login controls (`40px` input and `42px` tabs). Increased them to `48px` and `44px`; the primary CTA remains `52px`.
4. Re-captured the full login, the `980px` fallback, the normalized side-by-side comparison and the mobile dashboard.
5. Verified `320`, `390`, `576`, `980`, `1024` and `1025px` boundaries, route interactions, unit tests, typecheck and production build.

No P0, P1 or visible P2 issue remains in the checked responsive flows.

## Visual target

- Selected reference: `/Users/konradstraszewski/.codex/generated_images/019fbd39-7657-7c42-815b-6f79f65c6000/exec-adb84ec6-56cd-4af8-90dc-d39c027e4ae1.png`
- Reference dimensions: `1487 × 1058`
- Route: `http://127.0.0.1:3006/preview`
- Browser: Codex in-app browser
- Desktop viewport: `1487 × 1058`, DPR 1
- Mobile viewport: `390 × 844`, DPR 1

## Captures

- Desktop implementation: `apps/client/design-qa-desktop.png` (`1487 × 1058`)
- Reference + implementation comparison: `apps/client/design-qa-comparison.png` (`2974 × 1058`)
- Mobile implementation: `apps/client/design-qa-mobile.png` (`390 × 844`)
- Multiwniosek: `apps/client/design-qa-multiform.png` (`1487 × 1058`)
- Dashboard desktop: `apps/client/design-qa-dashboard-desktop.png` (`1487 × 1058`)
- Dashboard mobile: `apps/client/design-qa-dashboard-mobile.png` (`390 × 844`)
- Dashboard reference comparison: `apps/client/design-qa-dashboard-comparison.png` (`2974 × 1058`)

## Dashboard state and comparison

- Checked state: missing-document next action, upcoming online appointment, assigned expert and two shared cases.
- The selected source is the visual-system truth for the dashboard (header, type scale, monochrome palette, borders, radii, spacing and Lucide icon language), not a composition-level dashboard reference.
- The full-view side-by-side comparison therefore checks those shared system surfaces while the dashboard hierarchy is evaluated against the requested information architecture.
- A separate focused crop was not needed: the dominant action, appointment, expert and case cards are all visible together in the normalized desktop capture.

### Five visual surfaces

1. Layout and hierarchy: the black “Co teraz” card is dominant; appointment and expert are secondary; case list is tertiary.
2. Typography: DM Sans scale, weights and compact uppercase eyebrows match the selected portal direction.
3. Color and contrast: monochrome surfaces and the small green responsibility indicator remain legible at both viewport sizes checked.
4. Components and icons: buttons, pills, cards, borders, radii and Lucide icons follow the existing portal system.
5. Responsive behavior: mobile preserves the action → appointment → expert → cases order and removes the redundant one-item bottom navigation.

## Interaction checks

- Mobile case details open and close correctly.
- Contact dialog opens, exposes the message field and keeps submit disabled for an empty message.
- Document CTA opens a single-file chooser.
- Multiwniosek renders the unlocked three-step form and persists navigation from step 1 to step 2.
- Locked Multiwniosek explains that the expert has not shared the form yet and links back to the case.
- Preview and Multiwniosek produced no browser console errors or warnings during the checks.
- Dashboard contains the complete case list; a case opens its detail and `Wróć do „Co teraz”` returns to the dashboard.
- Legacy `/cases` links redirect to “Co teraz” instead of exposing a duplicate top-level destination.
- A fresh dashboard tab produced no browser console errors or warnings on desktop or mobile.

## Iteration history

1. Compared the implementation and selected reference side by side at the reference dimensions.
2. Fixed completed progress markers that were transparent because the semantic success alias was undefined; the component now uses the defined Nuxt UI success token.
3. Re-captured and re-compared the desktop view. Header, sidebar proportions, task card, case timeline and contact row align with the selected direction.
4. Fixed Multiwniosek persistence by cloning the raw reactive answers object before saving; verified that the first CTA advances to step 2 and shows a success toast.
5. Verified the responsive layout, mobile details panel, contact modal, file chooser and both expert-controlled Multiwniosek states.
6. Added the dashboard and compared it with the visual target at the same `1487 × 1058` viewport and density.
7. Found a visible desktop P2 where navigation icon wrappers bypassed the desktop hide rule; added the dedicated icon class, re-captured and confirmed text-only desktop navigation with icon-assisted mobile navigation.
8. Re-checked desktop and `390 × 844` mobile states, case-list/detail navigation, preview labeling and a clean console.
9. Removed misleading real-panel notification copy and corrected client-authored timeline messages so preview data and API-backed data retain honest authorship and state.
10. Consolidated client navigation around “Co teraz”: removed the duplicate “Moje sprawy” tab, moved case returns to the dashboard and retained `/cases` only as a compatibility redirect.

No P0, P1 or visible P2 issue remains in the checked portal flow.
