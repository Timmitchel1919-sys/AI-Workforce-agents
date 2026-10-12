# Command: /ux-review

## Purpose
Review UI implementation quality, design specification compliance, code structure, usability, accessibility, and visual consistency of proposed frontend changes or target components.

---

## Operating Principles
1. **Objective Evaluation**: Evaluate code strictly against established design specifications, project standards (`AGENTS.md`, `CLAUDE.md`, `ux-intelligence/standards.md`), and WCAG 2.1 AA rules.
2. **Never Auto-Approve Failures**: Do not approve implementations with failing typechecks, failing unit tests, unhandled error states, or critical accessibility violations.
3. **Structured & Actionable Feedback**: Clearly separate blocking findings from non-blocking suggestions, providing precise code locations and remediation examples.

---

## Review Workflow

### Step 1: Target & Change Set Inspection
- Identify the target components, pages, or git diff to review.
- Inspect JSX/TSX source code, CSS files, state hooks, and routing configurations.

### Step 2: Design Specification Comparison
- Compare implementation against design requirements, branding tokens, and wireframes/specifications.
- Verify component layout, typography, color palette, spacing, and icon usage.

### Step 3: Multi-Criteria Code & Quality Evaluation
Evaluate implementation across 5 core quality criteria:
1. **Accessibility Compliance**:
   - Contrast ratios (minimum 4.5:1 text, 3:1 UI controls).
   - Focus ring visibility (`:focus-visible`).
   - Semantic markup, ARIA roles, form labels, keyboard navigation.
2. **Code Structure & Architecture**:
   - React 19 / TypeScript best practices (strict mode, clean prop interfaces, no `any` types).
   - Component decomposition, reusability, and separation of concerns.
   - Proper hook usage (React Query, custom hooks) and state immutability.
3. **Design System & Styling**:
   - Adherence to design tokens (`tokens.css`, `os-theme.css`, `glass-panels.css`).
   - Absence of arbitrary hardcoded magic values (e.g. `margin: 17px`, `color: #3b82f6`).
4. **State & Interaction Completeness**:
   - Complete coverage of interaction states (Idle, Hover, Focus, Active, Disabled, Loading, Error, Success).
   - Defensive error boundaries and invalid input handling.
5. **Responsiveness & Motion**:
   - Viewport adaptability (mobile <640px to desktop 1024px+).
   - Reduced motion support (`prefers-reduced-motion`).

### Step 4: Automated Verification Execution
Execute standard project validation commands:
- TypeScript typecheck: `npm run typecheck` or `npm run build` in `ui/`.
- Component / unit tests: `npm run test` in `ui/`.
- Linter checks: `npm run lint` in `ui/`.

### Step 5: Finding Categorization
Classify all findings into two distinct buckets:
- **BLOCKING ISSUES**: Must be resolved before merging or approving (type errors, test failures, critical accessibility bugs, broken interaction handlers, hardcoded secrets).
- **NON-BLOCKING SUGGESTIONS**: Recommended enhancements or code refactorings that improve maintainability or polish without blocking progress.

### Step 6: Review Verdict & Recommendation Report
Issue a formal review verdict:
- **APPROVE**: Implementation satisfies all design, accessibility, typecheck, test, and code quality standards.
- **REVISE**: Implementation requires fixes for identified blocking issues before approval.
- **REJECT**: Implementation fundamentally violates design architecture, security boundaries, or accessibility requirements.

Include detailed finding tables, code diff suggestions, and exact validation outputs in the report.
