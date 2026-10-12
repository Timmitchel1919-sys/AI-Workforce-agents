# Command: /ux-audit

## Purpose
Perform an evidence-based UX, usability, and accessibility audit of target pages or components in the codebase, producing a structured finding report with actionable remediation guidance.

---

## Operating Principles
1. **Read-Only Default**: Audit operations are strictly read-only and analytical by default. Do not mutate source code unless the user explicitly requests automated remediation.
2. **Evidence-Based Evaluation**: Base all findings on concrete inspection of source code, DOM structure, CSS rules, WCAG 2.1 AA benchmarks, or browser DevTools / automated test output.
3. **No Groundless Assertions**: Do not fabricate audit scores or issues. Every reported issue must reference exact line numbers, code snippets, or DOM paths.

---

## Audit Workflow

### Step 1: Scope & Target Identification
- Identify target pages, components, or user flows specified by the user (e.g. `ui/src/pages/Governance/SecurityPage.tsx` or `ui/src/components/...`).
- If no specific target is provided, prompt for a target or default to major active UI routes.

### Step 2: Codebase & UI Structure Inspection
- Inspect component JSX/TSX markup, semantic tags, ARIA attributes, form controls, and keyboard handling logic.
- Inspect styling files (`globals.css`, `tokens.css`, `os-theme.css`, component CSS) for contrast, sizing, media queries, and focus styles.

### Step 3: Tool-Assisted Analysis (Where Available)
- Run available verification tools:
  - TypeScript typecheck (`npm run typecheck` or `npm run build` in `ui/`).
  - Unit/Component tests (`npm run test` in `ui/`).
  - Automated browser / DevTools accessibility tools (Chrome DevTools MCP, axe-core, Lighthouse, or Playwright scripts if installed).

### Step 4: Comprehensive Multi-Dimension Audit
Evaluate the target across 6 core UX dimensions:
1. **Accessibility (WCAG 2.1 AA)**:
   - Color contrast ratio (minimum 4.5:1 text, 3:1 UI controls).
   - Visible focus indicators (`:focus-visible`).
   - Keyboard navigation and focus trapping.
   - Semantic HTML elements and ARIA roles/labels.
   - Reduced motion support (`prefers-reduced-motion`).
2. **Visual Consistency & Design Tokens**:
   - Adherence to design tokens (`tokens.css`).
   - Uniform spacing, typography hierarchy, and color palette.
3. **Responsive & Mobile Behavior**:
   - Layout adaptability across mobile (<640px), tablet (768px), and desktop (1024px+).
   - Horizontal overflow, touch target sizes (minimum 44x44px).
4. **Interaction & Feedback States**:
   - Completeness of the 8 interaction states (Idle, Hover, Focus, Active, Disabled, Loading, Error, Success).
5. **Form Usability & Error Handling**:
   - Explicit `<label>` associations (`htmlFor`), inline error messages, ARIA invalid states (`aria-invalid="true"`).
6. **Navigation & Information Architecture**:
   - Clear visual hierarchy, breadcrumbs, page titles, and intuitive action placement.

### Step 5: Finding Classification & Severity Scoring
Classify each finding into standardized severity tiers:
- **CRITICAL**: Prevents task completion or creates a severe accessibility blocker (e.g., keyboard trap, missing form label, unreadable contrast <2:1, broken navigation).
- **HIGH**: Significantly degrades UX or fails WCAG AA criteria (e.g., missing focus ring, touch target <32px, missing loading state on destructive action).
- **MEDIUM**: Noticeable visual inconsistency or minor usability defect (e.g., non-token hardcoded color, unharmonious font scaling).
- **LOW**: Minor polish recommendation or micro-interaction enhancement.

### Step 6: Audit Report Generation
Generate a structured markdown audit report containing:
- Executive Summary & Overall Score.
- Categorized Findings Table (Severity, Category, Location, Finding, Impact).
- Detailed Findings with Reproduction Steps & Specific Remediation Guidance (showing before/after code snippets).
- Recommended Remediation Roadmap.
