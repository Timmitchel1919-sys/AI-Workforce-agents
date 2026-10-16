# Premium Frontend Design Audit & Implementation Plan

**Project:** AI Workforce (ui workspace)
**Date:** 2026-10-16
**Scope:** Design system, components, styling, typography, motion, accessibility, performance.
**Status:** Audit only — no application code modified. Implementation gated behind this plan.

> The `/premium-frontend-design` and `/frontend-design` skills were not installed on this workspace. This audit was produced from a direct code survey using the project's existing design/engineering practices.

---

## 1. Executive Summary

The UI already carries a strong visual identity — Dark Obsidian + Liquid Glass with a metallic-gold accent — codified in `ui/src/styles/os-theme.css` and a token system in `ui/src/styles/tokens.css`. A pre-paint theme/lang script prevents FOUC. Framer Motion was just wired through `Reveal`, `Button`, and `Card`, so the motion foundation is in place.

**The identity is right. The gaps are refinement, consistency, and performance:**

1. Two parallel token systems (`tokens.css` vs. `os-theme.css` with `lp-*` prefix) that drift in intent and values.
2. Incomplete typographic scale — no display sizes, no fluid clamps, no self-hosted or preloaded brand font despite `--lp-font: Inter, Manrope`.
3. A 1.44 MB bundled `controlCenterRoutes` chunk (gzipped 363 KB) that dominates TTI on the control plane.
4. Light theme shifts brand hue (purple) vs. dark theme (neutral grey) — identity drifts between modes.
5. Accessibility is largely sound (focus rings, reduced motion, skip link) but needs reduced-transparency support and consistent focus parity on glass surfaces.

**Recommended direction:** keep the current Dark Bento + Liquid Glass identity. Promote it from "landing-only" to a system-wide language by unifying tokens, adding a display scale, hardening motion primitives, and splitting the control-plane bundle.

---

## 2. What's Already Working

| Area | Evidence | Verdict |
| --- | --- | --- |
| Design tokens | `ui/src/styles/tokens.css` (palette, surfaces, radii, shadows, spacing, type scale, motion) | Comprehensive, well-named |
| Dark/light theming | `[data-theme='light']` override block in `tokens.css`; pre-paint script in `index.html` | Robust, no FOUC |
| Brand identity | Dark Obsidian + Liquid Glass + gold accent in `os-theme.css` | Distinctive, premium-coded |
| Motion baseline | Framer Motion applied to `Reveal`, `Button`, `Card`; `useReducedMotion` honored | New but clean |
| Accessibility baseline | `aria-labelledby`, skip link, `focus-visible` outlines, `prefers-reduced-motion` CSS override | Solid floor |
| i18n | Early-paint language resolution, token-translated strings | Enterprise-ready |

---

## 3. Findings — Prioritized

### P0 — Must fix before claiming "premium production"

#### F1. Dual token systems drift
Two systems coexist: the global `--color-*`, `--text-*`, `--space-*` in `tokens.css`, and the landing/auth `--lp-*` in `os-theme.css`. Values overlap but diverge (e.g. `--color-text: #f8fafc` vs. `--lp-text: #f8fafc` — same; `--color-border: rgba(255,255,255,0.06)` vs. `--lp-glass-border: rgba(255,255,255,0.1)` — different). The landing identity cannot be adopted system-wide without reconciliation.
- **Impact:** every surface outside the landing looks "ordinary dark theme," not premium.
- **Risk:** low; mostly additive.

#### F2. Code-splitting the control plane
Build output shows `controlCenterRoutes-Dewl_Iel.js = 1,444 KB (363 KB gzipped)` plus a 779 KB vendor-ish `index` chunk. Lighthouse Performance will suffer on 3G/mid-tier mobile. All control-plane routes load eagerly together.
- **Target:** no single route chunk > 250 KB gzipped; vendor split for `firebase`, `react-three/*`, `framer-motion`.
- **Mechanism:** `React.lazy` per top-level route; manual Rollup `output.manualChunks` for heavy vendor libs.

#### F3. Brand font not actually loaded
`os-theme.css` declares `--lp-font: Inter, Manrope, "Segoe UI", system-ui, sans-serif`. `index.html` links no Google Fonts, no `@font-face`, no `<link rel="preload">`. Users without Inter installed render in system-ui — the obsidian/glass aesthetic falls apart on Windows (Segoe UI) and Linux (varies wildly).
- **Fix:** self-host Inter var + Manrope var, `font-display: swap`, preload the subset used by the hero.

### P1 — Visibly elevates perceived quality

#### F4. Typographic scale lacks display tier
`tokens.css` tops out at `--text-4xl: 2.5rem`. The hero (`.lp-hero__title`) sets its own size inline/via `LandingPage.css`. There is no systemic display scale (`display-xl`, `display-lg`, `display-md`) and no `clamp()` fluid typography — type does not breathe between viewports.
- **Add:** `--display-xl / lg / md / sm` using `clamp(min, pref, max)`; retire the one-off hero font-size.

#### F5. Light theme loses brand coherence
Dark theme uses neutral grey for `--color-primary` (`#cbd5e1`) and reserves purple + gold for accents. Light theme swaps `--color-primary` to purple `#5924c8` and shifts the hero to a lavender gradient. The brand "voice" changes with the mode.
- **Fix:** keep gold (`--color-brand-gold`) as the universal accent in both modes; use purple only for the hero/CTA band; keep neutrals as the primary surface language in both.

#### F6. Motion taxonomy is thin
We have `--duration-fast / --duration-normal / --ease-standard`. We lack: `--duration-slow`, `--ease-emphasized`, `--spring-soft`, `--spring-snappy`, a stagger constant, and shared `Variants` presets. Framer Motion snippets will drift across components.
- **Fix:** add motion tokens and a `ui/src/components/motion/presets.ts` exporting `fadeUp`, `stagger`, `springHover`, `springTap`, `scaleIn`. Reuse everywhere.

#### F7. Glass surfaces don't degrade gracefully
`backdrop-filter: blur(24px) saturate(150%)` is used widely without `@supports` fallbacks for older iOS/Firefox-without-flag. Users without backdrop-filter see transparent cards against the page background — illegible text.
- **Fix:** `@supports not (backdrop-filter: blur(1px)) { .ui-card, .lp-glass { background: var(--color-surface-solid); } }`
- Add `@media (prefers-reduced-transparency: reduce)` to swap glass → solid surfaces.

#### F8. Hover/focus parity on cards
`Card` lifts on hover via Framer Motion only when `interactive` or an `onClick` is set. Keyboard focus does not get the same lift, so keyboard users don't perceive the interactive affordance.
- **Fix:** mirror hover transform under `:focus-visible` via CSS (so it survives Framer's style application), add a visible focus ring on glass.

### P2 — Craft details

#### F9. No elevation hierarchy
Only `--shadow-sm / md / lg / card / card-hover` exist. There's no `--shadow-overlay` for popovers/dialogs, no `--shadow-sticky` for the TopBar. Dropdown/Dialog look like oversized cards.
- **Fix:** 6-step elevation scale tied to z-index intent, not pixel count.

#### F10. Spacing scale is non-fluid
Spaces jump 0.25 → 2 rem. No `--space-10`, `--space-12`, `--space-16`. Section rhythm has to be hard-coded per page.
- **Fix:** extend scale + add fluid section spacing via `clamp()`.

#### F11. Icon system is single-source
Only `lucide-react` is in play. Fine, but icon sizes are passed inline per-call (`<ArrowRight size={18} />`), so stroke width / size are inconsistent. There's no icon wrapper.
- **Fix:** `<Icon as={ArrowRight} size="md" />` wrapper that reads from tokens.

#### F12. Reduced-motion polish
`useReducedMotion` is honored in new components, but the existing `.lp-reveal` CSS keyframes elsewhere are left alone. Verify every CSS animation defers under `@media (prefers-reduced-motion: reduce)`.

#### F13. No skeleton motion variants
`Skeleton.tsx` exists but has no shimmer/pulse variants driven by motion tokens.

#### F14. Color contrast on muted text
`--color-text-muted: #94a3b8` on `--color-surface: rgba(17,17,17,0.72)` is near AA but fails AAA at 14 px. The `--color-text-disabled: #475569` on the same ground is 3.4:1 — fails AA.
- **Fix:** raise disabled to `#64748b` (4.5:1); mark `--color-text-muted` for body-14+ only.

#### F15. SVG and image performance
Hero `EarthHorizon` and `RotatingEmblem` are React/SVG components; no `loading="lazy"`, no `decoding="async"` for raster assets below the fold. The 1200-wide landing is image-heavy if any sections include screenshots.
- **Fix:** audit image usages, enforce `width/height` attrs, `fetchpriority="low"` below the fold.

---

## 4. Design Direction

The project should **not** adopt a wholesale new design language. The existing Dark Bento + Liquid Glass is premium when applied consistently. The plan:

- **Preserve:** Obsidian base (`#030304`), gold accent (`#d9ac52`), glass surfaces, grid overlay, rotating emblem.
- **Promote:** Lift the landing-only `--lp-*` glass primitives into the global token layer, then retire the duplicate names.
- **Refine:** Add a display tier to typography. Add a motion-token taxonomy. Harden glass fallbacks. Code-split the control plane.
- **Reserve "Liquid Glass" for structural chrome** (nav, sidebar, dialogs, cards) — not for every surface. Dense data tables should remain solid.
- **Reserve "Bento" grids for dashboard surfaces** (Overview, Operations, CostCenter) — large interior cards with a 12-col responsive grid, consistent gutters.

---

## 5. Prioritized Implementation Plan

Each phase is a self-contained PR. Validation gates: `tsc -b`, `npm run lint`, `npm run build`, visual check in Firebase Hosting preview.

### Phase 1 — Foundations (1–2 PRs)

1. **Unify tokens** (F1)
   - Fold `--lp-*` into `tokens.css` under namespaced keys (`--color-glass-bg`, `--color-glass-border`, …).
   - Keep `.os-theme` as a thin alias layer during migration.
   - Delete the duplicates once pages are migrated.
2. **Load the brand font** (F3)
   - Self-host Inter var (`.woff2`) under `ui/public/fonts/`.
   - `@font-face` with `font-display: swap`, `font-feature-settings: "cv11", "ss01"`.
   - Add `<link rel="preload" as="font" crossorigin>` to `index.html`.
3. **Add display scale + fluid spacing** (F4, F10)
   - `--display-2xl / xl / lg / md` using `clamp()`.
   - Fluid `--section-y: clamp(4rem, 8vw, 7rem)`.

### Phase 2 — Motion & Primitives (1 PR)

4. **Motion token taxonomy + presets** (F6)
   - Export `motion/presets.ts`: `fadeUp`, `stagger`, `springHover`, `springTap`, `scaleIn`, `reveal`.
   - Replace ad-hoc Variants in `HeroSection`, `Reveal`, `Button`, `Card`.
5. **Glass fallback + reduced transparency** (F7, F12)
   - `@supports`/`@media (prefers-reduced-transparency)` overrides on `.lp-glass`, `.ui-card`, dropdowns, dialogs.
6. **Focus-visible parity on hover-animated components** (F8)
   - CSS `:focus-visible` lift mirror; visible focus ring on glass.

### Phase 3 — Performance (1 PR)

7. **Route code-splitting** (F2)
   - `React.lazy` each top-level control-plane page (`Admin`, `CostCenter`, `Operations`, `SoftwareFactory`, `SpatialGraph`, `WorkflowStudio`).
   - Vite `rollupOptions.output.manualChunks`: `firebase`, `three`, `@react-three`, `framer-motion`, `recharts` (if used), `tanstack`.
   - Target: largest route chunk ≤ 250 KB gzipped. Verify with `vite build --mode production` report.

### Phase 4 — Craft (1–2 PRs)

8. **Elevation scale** (F9) — add `--shadow-overlay`, `--shadow-popover`, `--shadow-dialog`, `--shadow-sticky`.
9. **Icon wrapper** (F11) — `<Icon as={LucideIcon} size tone />`, strokeWidth from tokens.
10. **Light theme accent coherence** (F5) — retire purple as the dominant primary; keep gold universal, purple as hero-only accent.
11. **Contrast fixes** (F14) — raise `--color-text-disabled`; audit via `@axe-core/react` in dev.
12. **Image/SVG performance** (F15) — lazy decoding, explicit dimensions.
13. **Skeleton motion variants** (F13).

### Phase 5 — Bento polish (optional)

14. **Overview + Operations as Bento grids** — 12-col responsive grid, consistent 24 px gutter, interior cards use the unified glass + hover-lift. The existing `overview-widgets` loop in `OverviewPage.tsx` is already most of the way there.

---

## 6. Non-Goals

- Framework swap (keep Vite + React 19).
- CSS-in-JS adoption (keep CSS modules / global tokens — change already in flight is enough).
- Component library replacement (keep the hand-rolled `ui/src/components/ui/*`).
- Dropping `three`/`@react-three/*` (used by the spatial graph).

---

## 7. Acceptance Metrics

| Metric | Current (approx.) | Target |
| --- | --- | --- |
| Largest route chunk (gzipped) | 363 KB | ≤ 250 KB |
| Initial JS on `/` (gzipped) | ~310 KB | ≤ 180 KB |
| Lighthouse Performance (mobile) | not measured | ≥ 90 |
| Lighthouse Accessibility | not measured | ≥ 95 |
| Font swap flash | present (system → nothing) | eliminated via preload + swap |
| Reduced-motion coverage | partial | 100% of motion |
| Reduced-transparency coverage | 0% | 100% of glass |
| Token duplication (`--lp-*` vs `--color-*`) | ~40 overlapping | 0 |

---

## 8. Open Questions (for the owner)

1. Is Inter + Manrope the final brand pairing, or should we audition a display face (e.g., Söhne, Suisse Int'l, GT Walsheim) for the hero?
2. Should the light theme be deprioritized? Usage telemetry would decide — if < 5% opt-in, we can simplify and lock the brand to dark.
3. Any customer segments on iOS < 14 or Firefox-no-backdrop-filter that need firm legibility guarantees? That changes the glass fallback aggressiveness.
4. Can we commit to one Bento grid breakpoint set (12-col → 8-col → 4-col), or do we need a bespoke grid per dashboard?

---

**Next step on approval:** open PR for Phase 1 (token unification + brand font + display scale). Phase 2 lands immediately after.
