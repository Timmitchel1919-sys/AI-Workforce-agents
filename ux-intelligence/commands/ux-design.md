# Command: /ux-design

## Purpose
Design a new user interface component, page, or complete user flow, or restructure an existing UX architecture in alignment with the AI Workforce OS design system, accessibility standards, and core platform requirements.

---

## Operating Principles
1. **Default to Project Branding**: Always align with the established AI Workforce OS design tokens (`tokens.css`, `os-theme.css`, `glass-panels.css`).
2. **User-Centric Intent Alignment**: Analyze user requirements, target persona, and workflow goals before drafting specifications or writing code.
3. **Accessibility By Design**: Build WCAG 2.1 AA compliance into the specification from the start (contrast, keyboard navigation, ARIA, touch targets).
4. **Rich & Modern Aesthetics**: Create interfaces that feel state-of-the-art, dynamic, and visually premium (glassmorphism, tailored HSL color palettes, subtle micro-animations).

---

## Design Workflow

### Step 1: User Intent & Goal Analysis
- Analyze the user's prompt, feature request, or target workflow.
- Define user goals, key tasks, data inputs/outputs, and primary calls to action (CTAs).

### Step 2: Project Context & Architecture Inspection
- Inspect relevant existing pages and components in `ui/src/`.
- Identify existing state management (React Query, custom hooks, context), routing (`react-router-dom`), and API endpoints.

### Step 3: Design System Resolution
- Map required UI elements to existing design tokens and reusable components:
  - Color scheme & glassmorphic panel style.
  - Typography scale and icon set (`lucide-react`).
  - Form controls, modal dialogs, tables, metrics cards, or spatial 3D views.

### Step 4: Information Architecture & User Flow Definition
- Specify page layout structure: Header, Sidebar/Navigation, Main Content Grid, Action Bar, Modal/Drawer overlays.
- Define user interaction flow: Entry point -> Data presentation -> Interaction -> State mutation -> Feedback/Confirmation.

### Step 5: Detailed Component & Layout Specification
Draft comprehensive UI specification covering:
- Layout Grid & Responsiveness (Mobile, Tablet, Desktop, Wide).
- Component hierarchy and TSX structure.
- State Matrix (Idle, Hover, Focus, Active, Disabled, Loading, Error, Success).
- Accessibility Attributes (`role`, `aria-label`, `aria-describedby`, `tabIndex`, `htmlFor`).

### Step 6: Implementation (When Authorized)
When requested and authorized by the user:
- Implement clean, modular TypeScript / React 19 components in `ui/src/components/` or `ui/src/pages/`.
- Implement associated CSS using design tokens and utility variables.
- Ensure strict TypeScript typing (`interface Props`, strong event handler types).
- Wire state management, React Query hooks, or API client calls safely.

### Step 7: Output Validation
- Run TypeScript typecheck: `npm run typecheck` or `npm run build` in `ui/`.
- Run tests: `npm run test` in `ui/`.
- Verify responsive layout and keyboard accessibility.

### Step 8: Design Handover & Summary
Report to the user:
- Architecture overview of the new/redesigned UI.
- List of created or modified files.
- Design specifications and accessibility highlights.
- Instructions for previewing or testing the UI.
