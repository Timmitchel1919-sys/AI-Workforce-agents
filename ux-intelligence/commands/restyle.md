# Command: /restyle

## Purpose
Improve the visual appearance, styling consistency, and design token adherence of an existing user interface component or page without breaking underlying business logic, state management, or API contracts.

---

## Operating Principles
1. **Preserve Business Logic**: Never modify data flows, state mutations, handler logic, or API contracts while restyling.
2. **Design Token Alignment**: Use existing project tokens (`ui/src/styles/tokens.css`, `os-theme.css`, `glass-panels.css`). Do not introduce arbitrary ad-hoc inline styles or hardcoded RGB values.
3. **Accessibility First**: Ensure restyled elements meet WCAG 2.1 AA contrast, touch target size, and focus ring standards.
4. **No Feature Removal**: Never silently delete visual elements, text, or functional controls.

---

## Restyling Workflow

### Step 1: UI & Token Inspection
- Locate and inspect the target UI file(s) (e.g. `ui/src/components/...` or `ui/src/pages/...`).
- Inspect associated CSS/styling files and imported design tokens.
- Identify current styling patterns, font sizes, colors, spacing, and layout structures.

### Step 2: Visual Inconsistency Audit
- Identify design defects: unharmonious colors, improper spacing, missing hover/focus states, inconsistent typography, or outdated layout structures.
- Verify if glassmorphism, dark/light mode CSS variables, or elevation tokens are underutilized.

### Step 3: Business Logic & Contract Guard
- Map all interactive handlers (`onClick`, `onSubmit`, `onChange`), props, and API bindings.
- Guarantee that all restyling operations maintain exact prop signatures, state definitions, and accessibility DOM attributes (`aria-*`, `id`, `htmlFor`).

### Step 4: Restyling Proposal & Approval
- Formulate a clear restyling plan summarizing:
  - Visual enhancements to be applied.
  - CSS tokens and variables to be used.
  - Interaction states to be added or improved.
- Present the proposal to the user before executing changes if large structural edits are involved.

### Step 5: Implementation
- Apply restyling changes to CSS files or component styles.
- Enhance typography, color contrast, border radii, shadows, and glassmorphic panels.
- Add micro-animations and smooth transitions (`150ms-250ms ease-out`).
- Implement all 8 required interaction states (Default, Hover, Focus, Active, Disabled, Loading, Error, Success).

### Step 6: Responsiveness & Accessibility Validation
- Verify responsive layout at mobile (`<640px`), tablet (`768px`), desktop (`1024px+`), and wide viewports.
- Confirm keyboard navigation (`Tab`, `Shift+Tab`, `Space`, `Enter`) and high-contrast `:focus-visible` rings.

### Step 7: Automated Validation
- Run TypeScript typecheck: `npm run typecheck` (or `npm run build` in `ui/`).
- Run relevant unit/component tests: `npm run test` in `ui/`.

### Step 8: Execution Summary Report
Report to the user:
- List of modified styling and component files.
- Summary of visual improvements applied.
- Verification results (typecheck and test outcomes).
