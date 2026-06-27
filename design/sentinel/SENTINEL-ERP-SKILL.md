# NEXUS ERP — Design System SKILL.md
**Palantir Blueprint × Stripe Dashboard — Enterprise Dark UI Framework**

> This skill defines the complete visual language, design tokens, component patterns, and implementation rules for building enterprise-grade ERP interfaces inspired by Palantir Gotham/Foundry and Stripe Dashboard.
> Paste this file at the top of any Cursor prompt where you want to build screens in this system.

---

## 1. Philosophy & Aesthetic Direction

### Core Tenets
- **Data density first.** Every pixel must earn its place. No decorative elements that don't carry information.
- **Dark by default.** All interfaces use a deep navy ink palette. Light mode is a secondary concern.
- **Precision over personality.** Grid-heavy, monochromatic, technical. Trust over friendliness.
- **Information hierarchy through weight, not color.** Color is reserved for semantic meaning (status, intent).
- **Monospaced numerics everywhere.** All monetary, numeric, and ID values use IBM Plex Mono with `font-feature-settings: "tnum"`.

### Aesthetic Reference
- **Palantir Gotham/Foundry**: High-density kanban boards, dark sidebar navigation, Blueprint component library patterns, cobalt blue primary accent, tightly-spaced data rows.
- **Stripe Dashboard**: Clean tabular data, pill/chip filters, subtle badge status indicators, Sohne-like thin weight display typography, negative letter-spacing on display sizes, tabular figure treatment on money.
- **Combined**: A dark operational command center for enterprise data — think military-grade clarity meets fintech precision.

---

## 2. Color System

### Core Palette — Design Tokens

```css
:root {
  /* ── Ink Scale (background layers) ── */
  --ink-950:   #080c10;   /* deepest bg, used for body fills */
  --ink-900:   #0d1117;   /* page background */
  --ink-850:   #111820;   /* topbar, sidebar */
  --ink-800:   #161d28;   /* raised surfaces, table headers */
  --ink-750:   #1c2535;   /* overlay panels */
  --ink-700:   #202c3e;   /* panel surfaces */
  --ink-600:   #2a3a52;   /* hover states, active fills */
  --ink-500:   #3a4f6a;   /* borders-strong */
  --ink-400:   #506180;   /* borders-default */
  --ink-300:   #6e7f96;   /* borders-subtle */
  --ink-200:   #8fa0b5;   /* text-muted */
  --ink-100:   #b8c8d8;   /* text-secondary */
  --ink-050:   #dce6ef;   /* text-primary (near-white on dark) */

  /* ── Cobalt Blue (Palantir primary accent) ── */
  --cobalt-700: #0d47a1;
  --cobalt-600: #1565c0;
  --cobalt-500: #1976d2;
  --cobalt-400: #2196f3;   /* interactive elements */
  --cobalt-300: #42a5f5;   /* active text, links */
  --cobalt-200: #90caf9;   /* soft accents */
  --cobalt-100: #bbdefb;   /* lightest cobalt */

  /* ── Stripe Indigo (CTA / feature highlight) ── */
  --stripe-indigo:  #533afd;
  --stripe-soft:    rgba(83, 58, 253, 0.12);
  --stripe-glow:    rgba(83, 58, 253, 0.25);

  /* ── Semantic Intent Colors ── */
  --intent-primary:    #2d72d2;
  --intent-primary-bg: rgba(45, 114, 210, 0.10);

  --intent-success:    #15b371;
  --intent-success-bg: rgba(21, 179, 113, 0.08);

  --intent-warning:    #d9822b;
  --intent-warning-bg: rgba(217, 130, 43, 0.08);

  --intent-danger:     #cd4246;
  --intent-danger-bg:  rgba(205, 66, 70, 0.08);

  /* ── Text Scale ── */
  --text-primary:   #e8f0f8;   /* main content */
  --text-secondary: #8fa0b5;   /* supporting labels */
  --text-muted:     #506180;   /* metadata, timestamps */
  --text-disabled:  #3a4f6a;   /* unavailable states */

  /* ── Border Scale ── */
  --border-subtle:  rgba(255,255,255,0.06);  /* hairline separators */
  --border-default: rgba(255,255,255,0.10);  /* card/panel edges */
  --border-strong:  rgba(255,255,255,0.18);  /* interactive borders */
  --border-focus:   rgba(45,114,210,0.70);   /* focus rings */

  /* ── Surface Layers ── */
  --surface-base:    var(--ink-900);   /* page */
  --surface-raised:  var(--ink-800);   /* cards */
  --surface-overlay: var(--ink-750);   /* modals, dropdowns */
  --surface-panel:   var(--ink-700);   /* side panels */
  --surface-hover:   var(--ink-600);   /* row/item hover */
}
```

### Color Usage Rules
| Context | Token |
|---|---|
| Page background | `--ink-900` |
| Sidebar / topbar | `--ink-850` |
| Card / panel surface | `--ink-800` |
| Table header background | `--ink-800` |
| Row hover | `--ink-600` |
| Primary action / link | `--intent-primary` / `--cobalt-400` |
| CTA button (conversion) | `--stripe-indigo` |
| Success state | `--intent-success` |
| Warning state | `--intent-warning` |
| Danger / error state | `--intent-danger` |
| All numeric / money text | IBM Plex Mono + `tnum` feature |
| Borders | `--border-subtle` for separators, `--border-default` for components |

### Forbidden Color Uses
- ❌ No white/light backgrounds in dark mode
- ❌ No purple gradients (cliché)
- ❌ No `#fff` or `#000` hardcoded — always use token
- ❌ No color for decoration — only for semantic meaning
- ❌ No more than 2 accent colors per screen section

---

## 3. Typography

### Font Stack

```css
/* Primary — UI + body text */
--font-sans: 'IBM Plex Sans', -apple-system, system-ui, sans-serif;

/* Data / numerics / IDs / code */
--font-mono: 'IBM Plex Mono', 'Cascadia Code', 'SF Mono', monospace;
```

**Google Fonts import:**
```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet">
```

### Type Scale

| Role | Font | Size | Weight | Letter-spacing | Usage |
|---|---|---|---|---|---|
| Page Title | IBM Plex Sans | 20px | 300 | -0.3px | `<h1>` page headers |
| Section Title | IBM Plex Sans | 15px | 500 | -0.1px | Panel/card headings |
| KPI Value | IBM Plex Mono | 26–32px | 300 | -0.8px | Dashboard KPI numbers |
| Table Header | IBM Plex Mono | 10px | 500 | 0.08em | `<thead>` labels, uppercase |
| Body | IBM Plex Sans | 12–13px | 400 | 0 | Table cells, descriptions |
| Small / Meta | IBM Plex Mono | 10–11px | 400 | 0.06em | Timestamps, IDs |
| Sidebar Labels | IBM Plex Mono | 9px | 500 | 0.12em | Section group labels, uppercase |
| Amount / Money | IBM Plex Mono | 12px | 400 | 0 | `font-feature-settings: "tnum"` |
| Button | IBM Plex Sans | 12px | 500 | 0 | All button text |

### Typography Rules
- **All monetary values**: `font-family: var(--font-mono); font-feature-settings: "tnum";`
- **All IDs, hashes, order numbers**: IBM Plex Mono
- **Display numbers (KPIs)**: IBM Plex Mono, weight 300, letter-spacing -0.8px minimum
- **Sidebar section labels**: 9px, mono, 0.12em tracking, UPPERCASE
- **Table headers**: 10px, mono, 0.08em tracking, UPPERCASE, color `--text-muted`
- **Never use Inter, Roboto, or system fonts** — IBM Plex family only

---

## 4. Spacing System

Base unit: **8px**

```css
--sp-1:  4px;
--sp-2:  8px;
--sp-3:  12px;
--sp-4:  16px;
--sp-5:  20px;
--sp-6:  24px;
--sp-8:  32px;
--sp-10: 40px;
--sp-12: 48px;
```

| Component | Padding |
|---|---|
| Page content | `24px 32px` |
| Panel / card body | `16px 20px` |
| Panel header | `16px 20px` |
| Table cell | `12px 20px` |
| Topbar | `0 16px` height `48px` |
| Nav item | `0 16px` height `32px` |
| KPI card | `20px` |
| Button (default) | `0 12px` height `30px` |
| Badge | `0 6px` height `18px` |
| Filter chip | `0 8px` height `22px` |

---

## 5. Border Radius

```css
--radius-sm:   3px;   /* table cells, code blocks */
--radius-md:   5px;   /* buttons, badges, chips, inputs */
--radius-lg:   8px;   /* cards, panels */
--radius-xl:   12px;  /* modals, large surfaces */
--radius-pill: 100px; /* status badges, filter chips */
```

---

## 6. Shadows & Elevation

```css
--shadow-sm:   0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3);
--shadow-md:   0 4px 12px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.3);
--shadow-lg:   0 8px 24px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.4);
--shadow-glow: 0 0 0 1px var(--stripe-glow), 0 4px 16px rgba(83,58,253,0.15);
```

Use `--shadow-glow` only on stripe-indigo CTA buttons.
Cards use `border: 1px solid var(--border-subtle)` instead of shadows.

---

## 7. Component Patterns

### 7.1 App Shell Grid

```css
.app {
  display: grid;
  grid-template-columns: 220px 1fr;
  grid-template-rows: 48px 1fr;
  grid-template-areas:
    "topbar topbar"
    "sidebar main";
  min-height: 100vh;
}
```

### 7.2 Top Bar
- Height: **48px**
- Background: `--ink-850`
- Border-bottom: `1px solid var(--border-subtle)`
- Logo: IBM Plex Mono, 13px, 500, 0.08em tracking, UPPERCASE
- Logo mark: 22×22px, `--stripe-indigo` background, `--radius-sm`
- Search: centered, max-width 400px, height 28px
- Right actions: icon buttons 28×28px, env indicator pill, user avatar 24px

### 7.3 Sidebar Navigation
- Width: **220px**
- Background: `--ink-850`
- Border-right: `1px solid var(--border-subtle)`
- Section label: 9px mono, 0.12em tracking, UPPERCASE, `--text-muted`
- Nav item: height 32px, `border-left: 2px solid transparent`
- Active item: `border-left-color: --intent-primary`, background `--intent-primary-bg`, color `--cobalt-300`
- Badges: right-aligned, `--radius-pill`, 16px height

### 7.4 Panel / Card

```html
<div class="panel">
  <div class="panel-header">
    <!-- icon + title left, meta right -->
  </div>
  <div class="panel-body">
    <!-- content -->
  </div>
</div>
```

```css
.panel {
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-4) var(--sp-5);
  border-bottom: 1px solid var(--border-subtle);
}
```

### 7.5 Data Table

```css
thead th {
  padding: 8px 20px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  background: var(--ink-800);
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  user-select: none;
}
thead th.sorted { color: var(--cobalt-300); }
tbody tr { border-bottom: 1px solid var(--border-subtle); }
tbody tr:hover { background: var(--surface-hover); }
td { padding: 12px 20px; font-size: 12px; color: var(--text-secondary); }
td.primary { color: var(--text-primary); font-weight: 500; }
td.mono { font-family: var(--font-mono); font-size: 11px; }
```

**Entity Cell Pattern:**
```html
<div style="display:flex;align-items:center;gap:12px">
  <div class="entity-icon">TK</div>
  <div>
    <div class="entity-name">Company Name</div>
    <div class="entity-sub">ID · Segment</div>
  </div>
</div>
```

Entity icon: 28×28px, `--radius-md`, colored bg per segment with matching text.

### 7.6 Status Badges

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
```

| Variant | Background | Color | Border |
|---|---|---|---|
| `.success` | `--intent-success-bg` | `--intent-success` | `rgba(21,179,113,0.2)` |
| `.warning` | `--intent-warning-bg` | `--intent-warning` | `rgba(217,130,43,0.2)` |
| `.danger` | `--intent-danger-bg` | `--intent-danger` | `rgba(205,66,70,0.2)` |
| `.primary` | `--intent-primary-bg` | `--cobalt-300` | `rgba(45,114,210,0.2)` |
| `.neutral` | `rgba(255,255,255,0.04)` | `--text-muted` | `--border-subtle` |
| `.stripe` | `--stripe-soft` | `#a89aff` | `rgba(83,58,253,0.2)` |

Always include a `<span class="badge-dot">` (4×4px circle, `background: currentColor`) as the first child.

### 7.7 Buttons

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 500;
  font-family: var(--font-sans);
  transition: all 0.1s;
  cursor: pointer;
}
/* Ghost (secondary) */
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}
.btn-ghost:hover { background: var(--surface-hover); color: var(--text-primary); }

/* Primary (confirm/save) */
.btn-primary {
  background: var(--intent-primary);
  border: 1px solid rgba(45,114,210,0.5);
  color: #fff;
}
.btn-primary:hover { background: var(--cobalt-500); }

/* Stripe CTA (new order, checkout, key action) */
.btn-stripe {
  background: var(--stripe-indigo);
  border: 1px solid rgba(83,58,253,0.5);
  color: #fff;
  box-shadow: var(--shadow-glow);
}
.btn-stripe:hover { filter: brightness(1.1); }

/* Danger */
.btn-danger {
  background: transparent;
  border: 1px solid rgba(205,66,70,0.4);
  color: var(--intent-danger);
}
.btn-danger:hover { background: var(--intent-danger-bg); }
```

### 7.8 Filter Chips

```css
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-family: var(--font-mono);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  transition: all 0.1s;
}
.filter-chip:hover,
.filter-chip.active {
  background: var(--intent-primary-bg);
  border-color: rgba(45,114,210,0.4);
  color: var(--cobalt-300);
}
```

### 7.9 KPI Cards

```html
<div class="kpi-card">
  <div class="kpi-icon cobalt"><!-- SVG icon --></div>
  <div class="kpi-label">METRIC NAME</div>
  <div class="kpi-value">₺4.83M</div>
  <div class="kpi-delta up">▲ +12.4%</div>
  <div class="kpi-compare">vs prior period</div>
</div>
```

```css
.kpi-card {
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--sp-5);
  position: relative;
  overflow: hidden;
}
.kpi-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent);
}
.kpi-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.kpi-value {
  font-family: var(--font-mono);
  font-size: 26px;
  font-weight: 300;
  letter-spacing: -0.8px;
  color: var(--text-primary);
  line-height: 1;
  font-feature-settings: "tnum";
}
.kpi-delta.up   { color: var(--intent-success); }
.kpi-delta.down { color: var(--intent-danger); }
```

KPI icon variants:
- `.cobalt` → `--intent-primary-bg` bg, `--cobalt-300` color
- `.green`  → `--intent-success-bg`, `--intent-success`
- `.amber`  → `--intent-warning-bg`, `--intent-warning`
- `.red`    → `--intent-danger-bg`, `--intent-danger`

### 7.10 Activity Feed / Timeline

Timeline dot variants: `.success`, `.primary`, `.warning`, `.danger`
Each dot: 8×8px circle, `border: 1.5px solid [color]`, background from intent-bg.
Connecting line: 1px, `--border-subtle`.

```css
.activity-item {
  display: flex;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-subtle);
  transition: background 0.1s;
}
.activity-item:hover { background: var(--surface-overlay); }
.activity-title { font-size: 12px; color: var(--text-primary); }
.activity-meta  { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
```

### 7.11 Progress/Stat Bars

```html
<div class="stat-bar-track">
  <div class="stat-bar-fill" style="width: 84%"></div>
</div>
```

```css
.stat-bar-track { height: 3px; background: var(--border-subtle); border-radius: 2px; }
.stat-bar-fill  { height: 100%; border-radius: 2px; background: var(--intent-primary); }
/* Variants: .success → --intent-success; .warning → --intent-warning; .danger → --intent-danger; .stripe → --stripe-indigo */
```

### 7.12 Environment Indicator

```html
<div class="env-indicator">
  <span class="env-dot"></span>
  PRODUCTION
</div>
```

```css
.env-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  background: var(--intent-success-bg);
  border: 1px solid rgba(21,179,113,0.2);
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--intent-success);
  letter-spacing: 0.06em;
}
.env-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 2s infinite;
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
```

For `STAGING` environment: use `--intent-warning-bg` / `--intent-warning`.
For `DEVELOPMENT`: use `--intent-primary-bg` / `--cobalt-300`.

### 7.13 Tags (inline metadata)

```css
.tag {
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 5px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 9px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-subtle);
  color: var(--text-muted);
}
```

### 7.14 Form Inputs

```css
.input {
  height: 32px;
  background: var(--ink-800);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 0 12px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--text-primary);
  transition: border-color 0.15s;
  outline: none;
}
.input::placeholder { color: var(--text-muted); }
.input:focus { border-color: var(--border-focus); }
.input:hover { border-color: var(--border-strong); }
```

---

## 8. Layout Patterns

### Grid Layouts (Standard)
```css
/* 4-col KPI grid */
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }

/* Main content + right panel */
.two-col { display: grid; grid-template-columns: 1fr 340px; gap: 16px; }

/* Bottom 3-col equal */
.three-col { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
```

### Page Structure
```
┌─────────────────────────────────────────────┐
│ TOPBAR (48px)                               │
├────────────┬────────────────────────────────┤
│ SIDEBAR    │ PAGE HEADER (breadcrumb+title) │
│ (220px)    ├────────────────────────────────┤
│            │ CONTENT (padding: 24px 32px)   │
│            │  ┌─── KPI GRID (4 col) ──────┐│
│            │  └───────────────────────────┘│
│            │  ┌─── TABLE ──┐ ┌─ DETAIL ──┐│
│            │  └────────────┘ └───────────┘│
│            │  ┌── CHART ───┐ ┌─ FEED ────┐│
│            │  └────────────┘ └───────────┘│
│            │  ┌─ 3 COL BOTTOM ───────────┐│
│            │  └───────────────────────────┘│
└────────────┴────────────────────────────────┘
```

---

## 9. Icon Guidelines

- Use SVG icons, `stroke="currentColor"`, `stroke-width: 1.8` (UI icons) or `2` (emphasis)
- Default icon size in sidebar/nav: **14×14px**
- Panel titles: **13×13px**
- KPI icon containers: **28×28px** with rounded bg, icon **14×14px**
- Button icons: **12×12px**
- `fill="none"` always (outline style)
- No filled/solid icon variants in navigation

---

## 10. Animation & Transitions

```css
/* Micro-interactions */
transition: background 0.1s;      /* hover states */
transition: border-color 0.15s;   /* focus/hover inputs */
transition: all 0.1s;             /* buttons */
transition: color 0.1s;           /* nav items */

/* Status pulse (live indicators) */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}

/* Loading skeleton shimmer (optional) */
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
```

No entrance animations, no page transitions, no parallax. This is operational software.

---

## 11. Scrollbar Styling

```css
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--ink-600); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--ink-500); }

/* Firefox */
* { scrollbar-width: thin; scrollbar-color: var(--ink-600) transparent; }
```

---

## 12. Responsive Breakpoints

| Breakpoint | Layout change |
|---|---|
| `< 1280px` | KPI grid → 2×2 |
| `< 1024px` | Sidebar collapses to icon-only (60px) |
| `< 768px` | Single column, sidebar becomes bottom tab bar |
| `< 640px` | Tables switch to card view |

---

## 13. Data Formatting Rules

| Data type | Format | Font |
|---|---|---|
| Turkish Lira | `₺1,234,567.00` | IBM Plex Mono + tnum |
| Large amounts | `₺1.24M`, `₺890K` | IBM Plex Mono |
| Order IDs | `#ORD-091847` | IBM Plex Mono, --text-primary |
| Invoice IDs | `INV-2026-4821` | IBM Plex Mono, --cobalt-300 |
| SKU codes | `SKU-8821` | IBM Plex Mono |
| Dates | `18 May 26` (short) or `18 May 2026 · 09:14 UTC+3` (full) | IBM Plex Mono |
| Percentages | `+12.4%` with color (up=success, down=danger) | IBM Plex Mono |
| Customer segments | `Enterprise`, `Business`, `SMB`, `Retail` | Badge `.stripe` or `.primary` |

---

## 14. Accessibility

- All interactive elements must have `:focus-visible` ring: `box-shadow: 0 0 0 2px var(--border-focus)`
- Minimum contrast ratio: 4.5:1 for body text, 3:1 for large text / UI components
- WCAG 2.2 AA compliance target
- `--text-primary: #e8f0f8` on `--ink-900: #0d1117` → contrast ~12:1 ✓
- `--intent-success: #15b371` on dark surfaces → contrast ~5.2:1 ✓
- Sidebar active state: cobalt-300 on intent-primary-bg → tested compliant

---

## 15. Component Checklist (When Building New Screens)

Before generating any page, confirm:
- [ ] Background is `--ink-900` (page) or `--ink-800` (surface)
- [ ] All money/numeric values use IBM Plex Mono with `tnum` feature
- [ ] Status indicators use badge component, not plain text
- [ ] Navigation has active state with left border + cobalt-300
- [ ] Table headers are uppercase, 10px mono
- [ ] CTA button (main action) uses `--stripe-indigo`
- [ ] Secondary actions use `btn-ghost`
- [ ] Panel/cards have `border: 1px solid var(--border-subtle)` not shadows
- [ ] Timestamps use `--font-mono`, `--text-muted`
- [ ] Entity icons have colored backgrounds matched to their segment/status

---

## 16. File Structure (for full app)

```
src/
├── styles/
│   ├── tokens.css          ← All CSS variables from this file
│   ├── reset.css           ← Box-sizing, margin reset
│   ├── typography.css      ← Font imports + scale
│   ├── components/
│   │   ├── badge.css
│   │   ├── button.css
│   │   ├── chip.css
│   │   ├── kpi-card.css
│   │   ├── panel.css
│   │   ├── table.css
│   │   ├── timeline.css
│   │   └── activity-feed.css
│   └── layout/
│       ├── app-shell.css
│       ├── topbar.css
│       ├── sidebar.css
│       └── page.css
└── components/
    ├── TopBar.tsx
    ├── Sidebar.tsx
    ├── KPICard.tsx
    ├── DataTable.tsx
    ├── StatusBadge.tsx
    ├── ActivityFeed.tsx
    └── OrderDetail.tsx
```

---

## 17. Prompt Instructions for Cursor

When using this skill with Cursor, prefix your prompt with this file and add:

```
Build [SCREEN NAME] using the NEXUS ERP design system above.
- Dark theme only (--ink-900 background)
- IBM Plex Sans for UI, IBM Plex Mono for all numbers/IDs/metadata
- Follow all component patterns exactly as specified
- Use semantic intent colors (success/warning/danger/primary) for status
- All money values: font-feature-settings: "tnum"
- CTA buttons use --stripe-indigo
- No hardcoded hex colors — always use CSS variables
- Sidebar width 220px, topbar 48px, panel border-radius 8px
```

---

*NEXUS ERP Design System · Built on Palantir Blueprint + Stripe Design Language · Version 1.0.0*
