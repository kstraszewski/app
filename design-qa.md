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
