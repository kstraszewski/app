# Client portal design QA

Final result: passed

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
