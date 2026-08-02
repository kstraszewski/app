**Findings**

- No actionable P0, P1, or P2 differences remain.
- [P3] The browser-rendered card remains about 19% taller than the generated concept after normalizing both cards to the same width.
  Location: mobile `.action-update` card in `apps/client/app/components/PortalTimeline.vue`.
  Evidence: the concept card crop is 897 × 812 px and the final implementation crop is 358 × 387 CSS px. The focused comparison in `design-qa-mobile-variant-3-comparison-final.jpg` normalizes both to 720 px wide.
  Impact: the implementation is slightly roomier, but retains the selected two-tone hierarchy and fits fully at 390 × 844. The remaining height comes from readable browser text wrapping and the 48 px accessible CTA target.
  Fix: none required for acceptance; a later polish pass could reduce body copy to 13 px or the CTA below 48 px, but that would trade readability and touch comfort for closer mock density.
- [P3] The generated source contains a merged-character artifact in the task title.
  Location: source mock heading.
  Evidence: the source visually merges characters in “brakujące dokumenty”; the implementation renders the correct application copy.
  Impact: none; the implementation intentionally preserves correct product text.
  Fix: none.

**Comparison Target**

- Source visual truth: `/Users/konradstraszewski/.codex/generated_images/019fc2a4-8690-7ce2-b74f-680e3e45b2a4/exec-590f05f0-db20-4f1b-8283-a6e89b57ccd2.png`.
- Final browser-rendered implementation: `design-qa-mobile-variant-3-compact.jpg`.
- Live preview with the repository's longer default fixture: `design-qa-mobile-variant-3-live.jpg`.
- Route: `http://127.0.0.1:3016/preview/cases/case-preview-warszewo`.
- Viewport: 390 × 844 CSS px, device scale factor 1, light theme.
- State: `upload_document`, new update, expert `Konrad Administracyjny`, task `Uzupełnij brakujące dokumenty`, no deadline. This matching-content screenshot was captured by temporarily substituting preview data, then the fixture was reverted without leaving a diff. The shipped component styles are identical in the live preview.

**Normalization**

- Source pixels: 972 × 1619. The generated mock has no reliable declared device density, so it was not treated as a literal CSS-pixel capture.
- Implementation pixels: 390 × 844 at 390 × 844 CSS px and density 1.
- Full-view comparison: both images were scaled to 840 px high and centered in equal 800 × 900 cells.
- Focused card comparison: source crop 897 × 812 px and implementation crop 358 × 387 px were both scaled to 720 px wide and centered in equal 800 × 800 cells.
- Combined evidence: `design-qa-mobile-variant-3-comparison-final.jpg` (source left, implementation right; full view above, focused card below).

**Required Fidelity Surfaces**

- Fonts and typography: implementation uses the product's DM Sans variable font. Weight, hierarchy, capitalization, letter spacing, alignment, and wrapping match the concept's intent. Small text remains readable; no truncation is present.
- Spacing and layout rhythm: the selected black task region and warm-white action region are preserved as one clipped 18 px-radius card. Metadata, expert identity, CTA, file hint, divider, and safety note follow the concept's order. The final compact pass materially reduced the initial excess height.
- Colors and visual tokens: black, white, warm surface, muted neutral text, and existing border token match the monochrome source and the established OpenExpert design system. Contrast is strong in the task and CTA regions.
- Image quality and asset fidelity: the target has no photography or raster artwork. Document, upload, calendar, and lock symbols use the existing Nuxt UI Lucide icon library; no placeholder, emoji, handcrafted SVG, or CSS-drawn replacement was introduced.
- Copy and content: production copy is preserved. The implementation intentionally corrects the source mock's generated title artifact and supports longer real task text and optional deadlines.

**Responsive and Interaction Evidence**

- 390 × 844: `design-qa-mobile-variant-3-live.jpg`; the complete card is visible, `scrollWidth` and `clientWidth` both equal 390.
- 320 × 844: `design-qa-mobile-variant-3-320.jpg`; long title, description, deadline, expert row, and CTA reflow without horizontal overflow or clipping. Remaining content is reachable by normal vertical scrolling.
- 761 × 900: desktop styling remains active and unchanged; the two-tone restructuring is scoped to `max-width: 760px`.
- Primary interactions tested: details toggle opens and closes; “Dodaj dokument” opens one file chooser; no file was uploaded.
- Console check: no error or warning entries. Development logs contain only Vite connection messages and Vue's informational Suspense notice.

**Comparison History**

1. Initial comparison: `design-qa-mobile-variant-3-comparison.jpg`.
   Earlier P2 finding: the first implementation card was 358 × 476 px versus a 358 × 324 px width-normalized source, making the card about 47% taller and materially changing mobile density.
   Fixes made: reduced mobile outer padding, icon and avatar size, title and body type, section gaps, footer padding, safety-note grid, and CTA height while keeping the CTA at an accessible 48 px minimum.
2. Post-fix comparison: `design-qa-mobile-variant-3-comparison-final.jpg`.
   Result: the final card is 358 × 387 px, the source hierarchy and two-tone composition are preserved, all content remains readable, and the residual density difference is P3 rather than blocking.

**Implementation Checklist**

- [x] Match variant 3's black-upper/warm-lower card structure on mobile.
- [x] Keep expert identity, full-width upload CTA, file hint, divider, and safety note in the lower region.
- [x] Preserve long-content reflow and optional deadline rendering.
- [x] Preserve desktop layout above 760 px.
- [x] Verify 320 px and 390 px widths, interactions, console, tests, typecheck, and production build.

**Follow-up Polish**

- Optional only: revisit the final 19% height difference if future production copy becomes consistently shorter and a denser card is preferred over the current touch/readability balance.

final result: passed
