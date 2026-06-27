# Stripe UI Design System — Technical Reference
> Birebir Stripe Dashboard tasarım sistemi. Renk değerleri, tipografi, spacing, bileşenler ve kullanım kuralları.

---

## 1. RENK PALETİ (Color Tokens)

### Brand & Primary
| Token | Hex | Kullanım |
|-------|-----|----------|
| `--color-brand` | `#635BFF` | Primary CTA butonlar, aktif linkler, odak halkası |
| `--color-brand-dark` | `#4F46E5` | Hover state |
| `--color-brand-light` | `#EEF0FF` | Seçili satır bg, badge bg |

### Neutrals (Gray Scale)
| Token | Hex | Kullanım |
|-------|-----|----------|
| `--color-bg-base` | `#F6F8FA` | Sayfa arka planı |
| `--color-bg-surface` | `#FFFFFF` | Kart, tablo, modal |
| `--color-bg-subtle` | `#F0F2F5` | Sidebar bg, hover row |
| `--color-bg-muted` | `#E8ECF0` | Disabled state, divider |
| `--color-border` | `#E3E8EE` | Tüm kenarlıklar |
| `--color-border-strong` | `#C1C9D2` | Input focus border |
| `--color-text-primary` | `#0A2540` | Başlıklar, önemli veriler |
| `--color-text-secondary` | `#425466` | Açıklamalar, labels |
| `--color-text-muted` | `#697386` | Placeholder, metadata |
| `--color-text-disabled` | `#A3ACBA` | Disabled text |
| `--color-text-inverse` | `#FFFFFF` | Koyu bg üzeri metin |

### Semantic Colors
| Token | Hex | Kullanım |
|-------|-----|----------|
| `--color-success` | `#1A9E6A` | Succeeded badge text |
| `--color-success-bg` | `#CBFFE4` | Succeeded badge bg |
| `--color-success-border` | `#85EFAC` | Succeeded badge border |
| `--color-warning` | `#B45309` | Uncaptured/pending |
| `--color-warning-bg` | `#FEF3C7` | Warning badge bg |
| `--color-warning-border` | `#FCD34D` | Warning badge border |
| `--color-danger` | `#C0123C` | Failed/error |
| `--color-danger-bg` | `#FFE4E8` | Danger badge bg |
| `--color-danger-border` | `#FCA5A5` | Danger badge border |
| `--color-info` | `#0062D1` | Info/link states |
| `--color-info-bg` | `#DBEAFE` | Info badge bg |
| `--color-neutral-badge` | `#636E7B` | Canceled/neutral text |
| `--color-neutral-badge-bg` | `#EEF0F3` | Neutral badge bg |

### Sidebar / Nav
| Token | Hex |
|-------|-----|
| `--color-sidebar-bg` | `#0A2540` |
| `--color-sidebar-text` | `#9CB3C9` |
| `--color-sidebar-text-active` | `#FFFFFF` |
| `--color-sidebar-hover` | `#13344F` |
| `--color-sidebar-active` | `#1A4A6E` |
| `--color-sidebar-divider` | `#1D3F5E` |

---

## 2. TİPOGRAFİ (Typography)

### Font Ailesi
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, 
             "Helvetica Neue", Ubuntu, sans-serif;
/* Stripe'ın kendi ürününde özel "Stripe Sans" kullanılır, 
   ancak sistem fontları ile aynı görünümü yakalar */
```

### Font Scale
| Token | Size | Weight | Line Height | Kullanım |
|-------|------|--------|-------------|----------|
| `--text-2xl` | `24px` | `600` | `1.3` | Sayfa başlıkları (`<h1>`) |
| `--text-xl` | `20px` | `600` | `1.3` | Section başlıkları |
| `--text-lg` | `16px` | `600` | `1.4` | Card başlıkları |
| `--text-md` | `14px` | `400` | `1.5` | Body, tablo içeriği |
| `--text-sm` | `13px` | `400` | `1.5` | Labels, secondary info |
| `--text-xs` | `12px` | `400` | `1.4` | Metadata, timestamps |
| `--text-xs-bold` | `12px` | `600` | `1.4` | Tablo header, badge |
| `--text-mono` | `13px` | `400` | - | `font-family: 'SF Mono', SFMono-Regular, ui-monospace` — ID'ler, kodlar |

---

## 3. SPACING SİSTEMİ (Spacing Scale)

Stripe 4px base grid kullanır.

| Token | Value | Kullanım |
|-------|-------|----------|
| `--space-1` | `4px` | İkon-metin arası, inline gap |
| `--space-2` | `8px` | Badge padding, compact gap |
| `--space-3` | `12px` | Input padding-y, list item gap |
| `--space-4` | `16px` | Card padding, form gap |
| `--space-5` | `20px` | Section gap |
| `--space-6` | `24px` | Card padding büyük |
| `--space-8` | `32px` | Section margin |
| `--space-10` | `40px` | Page section gap |
| `--space-12` | `48px` | Hero/header padding |

---

## 4. BORDER & RADIUS

```css
--radius-sm:  4px;   /* Badge, tag, küçük bileşenler */
--radius-md:  6px;   /* Input, select, button */
--radius-lg:  8px;   /* Card, dropdown, modal */
--radius-xl:  12px;  /* Büyük kart, panel */
--radius-full: 9999px; /* Pill badge */

--border-width: 1px;
--border-color: #E3E8EE;
--shadow-sm:  0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
--shadow-md:  0 4px 6px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04);
--shadow-lg:  0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.04);
--shadow-focus: 0 0 0 3px rgba(99,91,255,0.25); /* Brand focus ring */
```

---

## 5. LAYOUT

### Sidebar
```
width: 220px (collapsed: 56px)
position: fixed, left: 0, top: 0
height: 100vh
background: #0A2540
```

### Main Content
```
margin-left: 220px
padding: 24px 32px
max-width: calc(100vw - 220px)
background: #F6F8FA
```

### Top Bar (içerik alanı içi)
```
height: 56px
display: flex, align-items: center, justify-content: space-between
border-bottom: 1px solid #E3E8EE
background: #FFFFFF
padding: 0 24px
```

### Grid
```css
/* İki kolon kart layout */
display: grid;
grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
gap: 16px;
```

---

## 6. BILEŞENLER (Components)

### 6.1 Buton

#### Primary Button
```css
background: #635BFF;
color: #FFFFFF;
border: none;
border-radius: 6px;
padding: 8px 14px;
font-size: 13px;
font-weight: 600;
cursor: pointer;
display: inline-flex; align-items: center; gap: 6px;

/* Hover */
background: #4F46E5;

/* Active */
background: #3730C8;
transform: translateY(1px);

/* Focus */
outline: none;
box-shadow: 0 0 0 3px rgba(99,91,255,0.25);
```

#### Secondary Button (Outline)
```css
background: #FFFFFF;
color: #0A2540;
border: 1px solid #E3E8EE;
border-radius: 6px;
padding: 7px 14px;
font-size: 13px;
font-weight: 500;

/* Hover */
background: #F6F8FA;
border-color: #C1C9D2;
```

#### Danger Button
```css
background: #DF1B41;
color: #FFFFFF;
/* same shape as primary */
```

### 6.2 Input / Form Fields

```css
.stripe-input {
  height: 36px;
  padding: 0 12px;
  background: #FFFFFF;
  border: 1px solid #E3E8EE;
  border-radius: 6px;
  font-size: 14px;
  color: #0A2540;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.stripe-input:focus {
  border-color: #635BFF;
  box-shadow: 0 0 0 3px rgba(99,91,255,0.15);
}
.stripe-input::placeholder { color: #A3ACBA; }

/* Label */
.stripe-label {
  font-size: 13px;
  font-weight: 500;
  color: #425466;
  margin-bottom: 4px;
}
```

### 6.3 Badge / Status Chip

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;          /* veya 9999px pill için */
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  border: 1px solid transparent;
}

/* Variants */
.badge-success  { color: #1A9E6A; background: #CBFFE4; border-color: #85EFAC; }
.badge-failed   { color: #C0123C; background: #FFE4E8; border-color: #FCA5A5; }
.badge-warning  { color: #B45309; background: #FEF3C7; border-color: #FCD34D; }
.badge-neutral  { color: #636E7B; background: #EEF0F3; border-color: #D1D5DB; }
.badge-info     { color: #0062D1; background: #DBEAFE; border-color: #93C5FD; }
.badge-purple   { color: #635BFF; background: #EEF0FF; border-color: #A5B4FC; }
```

**Status ikonları (SVG dot):**
```html
<!-- Succeeded dot -->
<svg width="8" height="8" viewBox="0 0 8 8">
  <circle cx="4" cy="4" r="3" fill="#1A9E6A"/>
</svg>
<!-- Failed dot -->
<circle fill="#C0123C"/>
<!-- Pending dot (animated pulse) -->
<circle fill="#B45309" class="pulse"/>
```

### 6.4 Tablo (Data Table)

```css
.stripe-table {
  width: 100%;
  border-collapse: collapse;
  background: #FFFFFF;
  border: 1px solid #E3E8EE;
  border-radius: 8px;
  overflow: hidden;
}

/* Header */
.stripe-table thead th {
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 600;
  color: #697386;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: #F6F8FA;
  border-bottom: 1px solid #E3E8EE;
  text-align: left;
  user-select: none;
  cursor: pointer; /* sortable */
}

/* Row */
.stripe-table tbody tr {
  border-bottom: 1px solid #F0F2F5;
  transition: background 0.1s;
}
.stripe-table tbody tr:hover { background: #F6F8FA; }
.stripe-table tbody tr:last-child { border-bottom: none; }

/* Cell */
.stripe-table td {
  padding: 12px 16px;
  font-size: 14px;
  color: #0A2540;
  vertical-align: middle;
}

/* Amount cell */
.stripe-table .amount-cell {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

/* ID/code cell */
.stripe-table .id-cell {
  font-family: 'SF Mono', ui-monospace, monospace;
  font-size: 12px;
  color: #425466;
}

/* Checkbox */
.stripe-table .checkbox-col { width: 40px; }
```

### 6.5 Tab Navigation

```css
.stripe-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid #E3E8EE;
  margin-bottom: 20px;
}
.stripe-tab {
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 500;
  color: #697386;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}
.stripe-tab:hover { color: #0A2540; }
.stripe-tab.active {
  color: #0A2540;
  border-bottom-color: #0A2540;
  font-weight: 600;
}
```

### 6.6 Filter Chips / Segmented Filter

```css
.filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.filter-chip {
  padding: 6px 14px;
  border: 1px solid #E3E8EE;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #425466;
  background: #FFFFFF;
  cursor: pointer;
  transition: all 0.15s;
}
.filter-chip:hover { border-color: #C1C9D2; background: #F6F8FA; }
.filter-chip.active {
  background: #F0F0FF;
  border-color: #635BFF;
  color: #635BFF;
  font-weight: 600;
}
```

### 6.7 Stat / KPI Card

```css
.stat-card {
  background: #FFFFFF;
  border: 1px solid #E3E8EE;
  border-radius: 8px;
  padding: 20px 24px;
}
.stat-card .stat-label {
  font-size: 13px;
  color: #697386;
  font-weight: 500;
  margin-bottom: 8px;
}
.stat-card .stat-value {
  font-size: 28px;
  font-weight: 700;
  color: #0A2540;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.stat-card .stat-delta {
  font-size: 12px;
  font-weight: 600;
  margin-top: 4px;
}
.stat-card .stat-delta.positive { color: #1A9E6A; }
.stat-card .stat-delta.negative { color: #C0123C; }
```

### 6.8 Sidebar Nav Item

```css
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13.5px;
  font-weight: 500;
  color: #9CB3C9;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  text-decoration: none;
  margin: 1px 8px;
}
.nav-item:hover { background: #13344F; color: #FFFFFF; }
.nav-item.active { background: #1A4A6E; color: #FFFFFF; }
.nav-item .nav-icon { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.85; }
```

### 6.9 Date Range Picker (Trigger)

```css
.date-picker-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #FFFFFF;
  border: 1px solid #E3E8EE;
  border-radius: 6px;
  font-size: 13px;
  color: #0A2540;
  cursor: pointer;
  font-weight: 500;
}
.date-picker-trigger:hover { border-color: #C1C9D2; background: #F6F8FA; }
```

### 6.10 Dropdown / Select

```css
.stripe-select {
  height: 34px;
  padding: 0 28px 0 10px;
  background: #FFFFFF url("chevron-down.svg") no-repeat right 8px center;
  background-size: 14px;
  border: 1px solid #E3E8EE;
  border-radius: 6px;
  font-size: 13px;
  color: #0A2540;
  appearance: none;
  cursor: pointer;
}
.stripe-select:focus {
  border-color: #635BFF;
  box-shadow: 0 0 0 3px rgba(99,91,255,0.15);
  outline: none;
}
```

---

## 7. İKON SİSTEMİ

Stripe kendi custom icon setini kullanır (Stripe Icons). Genel kullanım için:
- **Lucide Icons** — en yakın stil eşleşmesi
- **Heroicons** (outline variant, 16px/20px)
- **Feather Icons** — alternatif

```html
<!-- Kullanım boyutları -->
nav icon:     16×16px
table icon:   14×14px  
button icon:  14×14px (sol) veya 12×12px
heading icon: 20×20px
```

### Temel İkon Listesi (Status için)
```
check-circle    → Succeeded
x-circle        → Failed/Canceled
clock           → Pending/Processing  
alert-triangle  → Warning/Disputed
ban             → Blocked
refresh-cw      → Refunded
zap             → Instant
lock            → Captured/Secure
```

---

## 8. ANİMASYON & TRANSİSYON

```css
/* Standart geçişler */
--transition-fast:   0.1s ease;
--transition-base:   0.15s ease;
--transition-slow:   0.25s ease;

/* Hover row */
transition: background 0.1s ease;

/* Button */
transition: background 0.15s ease, transform 0.1s ease;

/* Focus ring */
transition: box-shadow 0.15s ease, border-color 0.15s ease;

/* Dropdown open */
animation: dropdownOpen 0.15s ease;
@keyframes dropdownOpen {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Skeleton shimmer */
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, #F0F2F5 25%, #E3E8EE 50%, #F0F2F5 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}
```

---

## 9. RESPONSIVE BREAKPOINTS

```css
--bp-sm:   640px;
--bp-md:   768px;
--bp-lg:   1024px;
--bp-xl:   1280px;
--bp-2xl:  1440px;
```

Stripe dashboard **1024px minimum** viewport için tasarlanmıştır. Sidebar 768px altında collapse olur.

---

## 10. Z-INDEX STACK

```css
--z-base:      1;
--z-sticky:    10;   /* Sticky header */
--z-dropdown:  100;  /* Dropdown menü */
--z-modal:     200;  /* Modal overlay */
--z-toast:     300;  /* Notification toast */
--z-tooltip:   400;  /* Tooltip */
```

---

## 11. TABLO SATIR STATÜLERİ — MUHASEBE

| Durum | Badge Class | İkon | Açıklama |
|-------|-------------|------|----------|
| Succeeded ✓ | `badge-success` | check | Ödeme tamamlandı |
| Failed ✗ | `badge-failed` | x-circle | Ödeme başarısız |
| Refunded ↩ | `badge-info` | refresh-cw | İade edildi |
| Partially Refunded | `badge-info` | refresh-cw | Kısmi iade |
| Canceled | `badge-neutral` | ban | İptal edildi |
| Pending | `badge-warning` | clock | İşlemde |
| Uncaptured | `badge-warning` | zap | Tutuldu, çekilmedi |
| Disputed | `badge-failed` | alert-triangle | İtiraz var |
| Blocked | `badge-neutral` | shield | Engellendi |
| Incomplete | `badge-warning` | alert-circle | Tamamlanmadı |

---

## 12. SANDBOX BANNER

```css
.sandbox-banner {
  background: #0D1117;
  color: #9CB3C9;
  font-size: 13px;
  text-align: center;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sandbox-banner .switch-btn {
  background: #635BFF;
  color: white;
  padding: 5px 12px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 600;
}
```

---

## 13. CSS CUSTOM PROPERTIES — TAM LİSTE

```css
:root {
  /* Brand */
  --color-brand:          #635BFF;
  --color-brand-dark:     #4F46E5;
  --color-brand-light:    #EEF0FF;

  /* Backgrounds */
  --color-bg-base:        #F6F8FA;
  --color-bg-surface:     #FFFFFF;
  --color-bg-subtle:      #F0F2F5;
  --color-bg-muted:       #E8ECF0;

  /* Borders */
  --color-border:         #E3E8EE;
  --color-border-strong:  #C1C9D2;

  /* Text */
  --color-text-primary:   #0A2540;
  --color-text-secondary: #425466;
  --color-text-muted:     #697386;
  --color-text-disabled:  #A3ACBA;
  --color-text-inverse:   #FFFFFF;

  /* Semantic */
  --color-success:        #1A9E6A;
  --color-success-bg:     #CBFFE4;
  --color-success-border: #85EFAC;
  --color-warning:        #B45309;
  --color-warning-bg:     #FEF3C7;
  --color-warning-border: #FCD34D;
  --color-danger:         #C0123C;
  --color-danger-bg:      #FFE4E8;
  --color-danger-border:  #FCA5A5;
  --color-info:           #0062D1;
  --color-info-bg:        #DBEAFE;
  --color-info-border:    #93C5FD;
  --color-neutral:        #636E7B;
  --color-neutral-bg:     #EEF0F3;
  --color-neutral-border: #D1D5DB;

  /* Sidebar */
  --color-sidebar-bg:           #0A2540;
  --color-sidebar-text:         #9CB3C9;
  --color-sidebar-text-active:  #FFFFFF;
  --color-sidebar-hover:        #13344F;
  --color-sidebar-active:       #1A4A6E;
  --color-sidebar-divider:      #1D3F5E;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  /* Radius */
  --radius-sm:   4px;
  --radius-md:   6px;
  --radius-lg:   8px;
  --radius-xl:   12px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm:    0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md:    0 4px 6px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04);
  --shadow-lg:    0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.04);
  --shadow-focus: 0 0 0 3px rgba(99,91,255,0.25);

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif;
  --font-mono: 'SF Mono', SFMono-Regular, ui-monospace, 'Cascadia Mono', monospace;

  /* Transitions */
  --transition-fast: 0.1s ease;
  --transition-base: 0.15s ease;
  --transition-slow: 0.25s ease;

  /* Z-index */
  --z-sticky:   10;
  --z-dropdown: 100;
  --z-modal:    200;
  --z-toast:    300;
}
```

---

*Bu doküman Stripe Dashboard'un görsel analizi ile oluşturulmuştur. Üretim kullanımı için Stripe'ın resmi tasarım dokümantasyonuna başvurun.*
