# VehicleSentinel — Foundry Design Spec

Source of truth: the approved wireframe study (`PalantirFoundry.zip` / `VehicleSentinel Web (Standalone).html`).
Implementation vocabulary: `src/styles/foundry-theme.css` (`.fd-*` classes) + `src/components/palantir/FoundryPipeline.jsx`.
This file is design/UX only — the site's real data and handlers always win over wireframe mock behavior.

## Tokens

| Token | Dark | Light |
|---|---|---|
| bg | `#0B0E13` | `#F2F5F8` |
| surface | `#151A21` | `#FFFFFF` |
| high | `#1E252E` | `#EBEFF3` |
| higher | `#252D38` | `#E2E8EE` |
| border | `#2C3540` | `#D3DAE1` |
| border-strong | `#3B4654` | `#B9C3CD` |
| text | `#D6DEE8` | `#1C2127` |
| text2 | `#A9B4C0` | `#3F4854` |
| muted | `#7D8A99` | `#687585` |
| accent | `#4C90F0` | `#215DB0` |
| green | `#3DC98A` | `#1D7A50` |
| amber | `#E5A83B` | `#946108` |
| red | `#E76A6E` | `#B0343A` |
| purple | `#9D7CD8` | `#634DBF` |

Dim fills = the color at ~10–14% alpha (`--fd-*-dim`). Fonts: `--fd-sans` for labels/prose, `--fd-mono` for ALL data (plates, times, money, codes, metadata).

## Non-negotiable conventions

1. **Zero border-radius.** Only pulse dots / timeline dots are round.
2. **Mono for data.** Any number, plate, res code, timestamp, or money renders in `--fd-mono` with `tabular-nums`.
3. **Uppercase tracked micro-labels.** Section headers `700 10px / .12em`; field labels `600 9px / .12em` muted; table headers `700 9px / .1em` muted on `--fd-high`.
4. **1px hairlines everywhere.** Panels `1px solid var(--fd-border)` on `--fd-surface`; sunken insets on `--fd-bg`; KPI strips via 1px-gap grid (`.fd-kpi-strip`).
5. **Status = tone pill.** `.fd-pill-{accent|green|amber|red|purple}`: 1px colored border over dim fill, `600 8.5px` mono caps. Grammar: active/in-motion=accent · complete=green · attention=amber · blocked/overdue=red · reserved/returns=purple · terminal-neutral=muted on high.
6. **Pipelines.** `FoundryPipeline` stages: done=green, active=accent bold, pending=hollow border-strong, blocked=red. Dot timeline for event history (`FoundryDotTimeline`).
7. **Hover language.** Rows→`--fd-high` bg; cards→border-strong; filled buttons→`brightness(1.12)`; ghosts→border-strong; destructive→red text+border.
8. **Screen entry** `fdFadeUp .3s ease` (`.erpx-view-layer`); respect `prefers-reduced-motion`.
9. **ALL-CAPS mono footnotes** under major tables explaining behavior (`.fd-footnote`).
10. **Density.** Row height ≈ 30–36px, screen padding 14px, panel gaps 10–12px, column gap 10px.

## Screen blueprints (from the wireframe)

- **Login**: split view — left brand panel (flex 1.15, accent gradient wash, logo chip `2px solid accent` + mono "VS", 34px headline, 3 mono stat columns with 1px dividers, mono build footer) | right centered 360px card (header bar + pulsing SYSTEMS NOMINAL, mono inputs on `--fd-bg`, franchise scope segmented chips, full-width accent CTA, mono footer).
- **Dashboard**: 6-col `.fd-kpi-strip` → grid `1.3fr 1fr 1fr`: live activity feed (time · 62px tone tag · text · operator, hover rows) | fleet status `.fd-bar-row` stack + utilization bar chart (`vsBarGrow`) | today movements list.
- **Vehicles**: toolbar = `.fd-chip-group` status filters with counts + `.fd-search` + ghost Import + primary Add; `.fd-table` cols `96px 1.4fr 64px 110px 90px 60px 1fr 90px 70px` → Plate(mono) · Model · ACRISS(mono muted) · Status pill · Odometer(mono) · Fuel · Location · Reservation(accent mono) · Damage count (green 0 / amber n); pagination footer mono.
- **Checkout / Returns**: `1fr 292px` grid. Left: `.fd-day-pager` + `.fd-accent-chip` TODAY + `.fd-search` + count; dense `.fd-table` with Status pill + `⬇ PDF` `.fd-inline-action`; `.fd-table-empty`; `.fd-footnote`. Right rail: mini-calendar panel + "Selected day" summary panel (label/value rows, tone-colored values).
- **Vehicle detail drawer**: sticky header (mono plate 15px + status pill + close), `.fd-spec-grid` 2×2 specs, damage stack (8×8 square severity swatch + part + mono meta + severity code), `FoundryDotTimeline` rental timeline, Processes tab rail + process cards (tone tag + mono code + DETAIL › action).
- **Process detail drawer**: sticky header (tone tag + mono title + status pill), `.fd-spec-grid` fields, `.fd-photo-grid` 4-col tiles, notes inset, PDF button pair with idle→busy(`◌ GENERATING…`)→done(`✓ DOWNLOADED` green) cycle.
- **Status-tone maps**: vehicles ON RENT=accent AVAILABLE=green RESERVED=purple IN SERVICE=amber DAMAGE HOLD=red · checkouts READY/DONE/ACTIVE=green DOCS/HOLD=amber PARKED=accent · returns ARRIVING=accent INSPECTING=amber FINALIZED=green OVERDUE=red.
