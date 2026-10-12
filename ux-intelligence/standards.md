# AI Workforce OS — Core UX & Accessibility Standards

## 1. Design Token Architecture & System Baseline
All user interface components in AI Workforce OS adhere to the tokens defined in `ui/src/styles/tokens.css` and `ui/src/styles/os-theme.css`.

### 1.1 Color Tokens (HSL Tailored)
- **Primary / Brand**: `hsl(var(--color-primary-h), var(--color-primary-s), var(--color-primary-l))`
- **Backgrounds**: Deep dark / glass modes with HSL layering.
- **Text & Foreground**: High-contrast contrast levels meeting WCAG 2.1 AA standards.
  - Primary Text: `hsl(0, 0%, 98%)` (Dark mode) / `hsl(220, 20%, 10%)` (Light mode)
  - Secondary Text: `hsl(220, 10%, 70%)` (Dark mode) / `hsl(220, 10%, 40%)` (Light mode)
  - Muted Text: `hsl(220, 10%, 50%)`
- **Semantic Colors**:
  - Success: `hsl(142, 70%, 45%)` (Green)
  - Warning: `hsl(38, 92%, 50%)` (Amber)
  - Error / Destructive: `hsl(0, 84%, 60%)` (Red)
  - Info: `hsl(217, 91%, 60%)` (Blue)

### 1.2 Typography & Scale
- **Font Stack**: System UI sans-serif stack (`system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif`) with fallback code font (`'JetBrains Mono', 'Fira Code', monospace`).
- **Hierarchy**:
  - Display / H1: `2rem` (32px), `line-height: 1.2`, `font-weight: 700`
  - H2: `1.5rem` (24px), `line-height: 1.3`, `font-weight: 600`
  - H3: `1.25rem` (20px), `line-height: 1.4`, `font-weight: 600`
  - Body Base: `1rem` (16px), `line-height: 1.5`, `font-weight: 400`
  - Body Small: `0.875rem` (14px), `line-height: 1.5`, `font-weight: 400`
  - Caption / Micro: `0.75rem` (12px), `line-height: 1.4`, `font-weight: 500`

### 1.3 Elevation & Glassmorphism
- **Glass Panel**: `background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1);`
- **Shadows**:
  - `--shadow-sm`: `0 1px 2px 0 rgba(0, 0, 0, 0.05)`
  - `--shadow-md`: `0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)`
  - `--shadow-glow`: `0 0 20px rgba(59, 130, 246, 0.3)`

---

## 2. Accessibility (WCAG 2.1 AA Compliance)

### 2.1 Color Contrast & Perception
- Normal text (under 18pt / 24px) MUST maintain a minimum contrast ratio of **4.5:1** against its background.
- Large text (18pt+ or 14pt+ bold) MUST maintain a minimum contrast ratio of **3:1**.
- Interactive UI boundaries and graphical icons MUST maintain at least **3:1** contrast.
- Color MUST NEVER be the sole indicator of state or meaning (always pair color with icons, text labels, or distinct patterns).

### 2.2 Keyboard Navigation & Focus Ring Standards
- All interactive controls (buttons, links, inputs, dropdowns, tabs) MUST be reachable via standard Keyboard Navigation (`Tab`, `Shift+Tab`, `Arrow keys`, `Enter`, `Space`, `Escape`).
- Focus indicators MUST use `:focus-visible` with a high-contrast outline (minimum 2px thickness with 2px offset).
- Custom modal dialogs or slide-over panels MUST trap keyboard focus while open and restore focus to the triggering element upon closing.

### 2.3 Semantic HTML & ARIA Attributes
- Prefer native HTML5 elements (`<button>`, `<a>`, `<input>`, `<main>`, `<nav>`, `<aside>`, `<header>`, `<footer>`, `<dialog>`) over generic `<div>` click handlers.
- When custom interactive widgets are required, provide explicit ARIA roles (`role="dialog"`, `role="tablist"`, `role="combobox"`, `role="alert"`), `aria-expanded`, `aria-selected`, `aria-controls`, and `aria-label` / `aria-labelledby`.
- Form inputs MUST be programmatically associated with visible `<label>` elements via `htmlFor` and `id`.

### 2.4 Touch & Click Targets
- Minimum interactive target size is **44 × 44 pixels** (or 40 × 40px with 4px padding/margin around it) to prevent accidental taps.

---

## 3. Responsive Layout & Breakpoints
- **Mobile First**: Layouts scale gracefully from small mobile viewports up to ultra-wide displays.
- **Breakpoints**:
  - `sm`: `640px`
  - `md`: `768px`
  - `lg`: `1024px`
  - `xl`: `1280px`
  - `2xl`: `1536px`
- Viewports MUST NOT horizontal-scroll on standard widths (320px minimum mobile width).
- Text MUST remain readable and non-overlapping when browser zoom is set to **200%**.

---

## 4. Interaction States Lifecycle
Every interactive component MUST explicitly handle and visually specify 8 core interaction states:
1. **Default / Idle**: Standard resting state with clear affordance.
2. **Hover**: Subtle elevation or background highlight to signal interactability.
3. **Focus (`:focus-visible`)**: High-contrast outline ring for keyboard users.
4. **Active / Pressed**: Down-press visual feedback (`transform: scale(0.98)` or darker background).
5. **Disabled**: Reduced opacity (`opacity: 0.5`), `cursor: not-allowed`, `pointer-events: none`, `aria-disabled="true"`.
6. **Loading / Pending**: Spinner or skeleton wave, disabling user re-click while maintaining layout stability.
7. **Error / Invalid**: Clear border indicator in error color (`var(--color-error)`), descriptive inline error text (`role="alert"`), `aria-invalid="true"`.
8. **Success / Completed**: Visual confirmation state (check icon or green highlight).

---

## 5. Motion & Animation Principles
- Transitions MUST use performant CSS properties (`opacity`, `transform`, `filter`). Avoid animating layout-triggering properties (`width`, `height`, `top`, `margin`).
- Duration: `150ms` for micro-interactions (button hover, focus ring), `250ms` for panel transitions, `350ms` for large view transitions.
- Reduced Motion: MUST respect `@media (prefers-reduced-motion: reduce)` by disabling non-essential motion or replacing slide/bounce with instant opacity fades.
