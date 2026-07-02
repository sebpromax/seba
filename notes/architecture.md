# Architecture

## Overview

Seba is a static site built with raw HTML, CSS, and vanilla JavaScript. There is no build system, no framework, no bundler. This is a deliberate constraint: during the prototype phase, friction should live in product decisions, not the toolchain.

Every page is self-contained — its CSS and JavaScript are inlined in `<style>` and `<script>` blocks within the same file. This eliminates external stylesheet round-trips and ensures critical styles are available before the first paint.

---

## Folder Structure

```
docs/                        # GitHub Pages root — everything here is live
│
├── index.html               # Landing page — primary acquisition surface
├── onboarding.html          # Account creation wizard (8-step flow)
├── tarifs.html              # Pricing (Solo / Pro / Team / Enterprise)
├── product.html             # Feature overview page
├── faq.html                 # Resources and FAQ
├── connexion.html           # Login page
├── dashboard.html           # Main app prototype
│
├── pro-global.css           # Shared CSS for internal app pages
├── favicon.jpg              # Site icon
│
└── [app pages]              # planning.html, devis.html, factures.html,
                             # clients.html, equipe.html, reglages.html, etc.
```

```
site/                        # Extended prototype (not GitHub Pages)
└── [additional pages]       # Earlier iterations and extended feature mockups
```

```
strategie/                   # Product strategy (not deployed)
├── Seba-vision-strategie.md # Vision, positioning, roadmap
├── plan-de-construction.md  # Build plan and progress tracking
└── [other strategy docs]
```

---

## Page Architecture

### Landing Page (`index.html`)

The landing page follows a narrative arc designed to move a visitor from awareness to intent:

```
Hero → Process → Problem → Dashboard Demo → Feature Cards (Bento) → CTA
```

Each section uses `<section class="section">` with a single CSS rule that handles all spacing, including responsive padding — no breakpoints needed for horizontal margins:

```css
.section {
  padding-top: 130px;
  padding-bottom: 130px;
  padding-left: max(24px, calc((100vw - 1140px) / 2));
  padding-right: max(24px, calc((100vw - 1140px) / 2));
}

@media (max-width: 768px) {
  .section { padding-top: 94px; padding-bottom: 94px; padding-left: 24px; padding-right: 24px; }
}
```

`max(24px, calc((100vw - 1140px) / 2))` centers the 1140px content column while keeping a minimum 24px gutter on any screen width. This replaces what most frameworks handle with container classes.

### Navigation

The nav uses a 3-column CSS Grid — no JavaScript needed for layout:

```css
.nav-wrap {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}
```

- Column 1 (`1fr`): Logo, anchored to the left via `justify-self: start`
- Column 2 (`auto`): Center links, naturally centered
- Column 3 (`1fr`): CTA buttons, anchored to the right via `justify-self: end`

On mobile (`< 768px`), columns 2 and 3 collapse (`display: none`) and the hamburger button takes over from column 3. The mobile menu is a full-viewport overlay driven by a simple `opacity` + `pointer-events` toggle.

### Onboarding (`onboarding.html`)

An 8-step wizard where each step is a full-viewport panel (`min-height: 100dvh`). Navigation is JS-driven — only the active step is visible (`display: flex`); all others are hidden (`display: none`). Step 0 contains a D3.js globe with a custom orthographic projection.

**Two-column layout per step:**

```css
.wizard-body {
  display: grid;
  grid-template-columns: 1fr 1fr;   /* equal columns */
  gap: 48px;
  align-items: center;
}
```

Left column: form fields. Right column: visual (globe, mockup, illustration).

### Pricing (`tarifs.html`)

Four-tier structure: Solo / Pro / Team / Enterprise. A billing toggle (monthly / annual) updates displayed prices via vanilla JS:

```javascript
const prices = {
  monthly: { solo: '19', pro: '29', team: '79' },
  annual:  { solo: '15', pro: '23', team: '63' }
};

function setBilling(mode) {
  const p = prices[mode];
  document.getElementById('solo-price').innerHTML = p.solo + ' <span>€</span>';
  // ...
  const period = mode === 'annual' ? '/ month · Billed annually' : '/ month · No commitment';
  document.getElementById('solo-period').textContent = period;
}
```

Enterprise pricing is always "On request" and is not updated by the toggle.

---

## CSS Architecture

**All CSS is inlined** in `<style>` blocks within each HTML file. This is intentional: it eliminates one network round-trip per page and guarantees critical styles render before the first paint.

**Typography:**

```
Font stack: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
```

Zero network dependency — the browser uses the operating system's native interface font (San Francisco on macOS/iOS, Segoe UI on Windows, Roboto on Android). This is the primary reason LCP stays under 500ms.

**Color system:**

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#0a0a0c` | All page backgrounds |
| Accent | `#00ff88` | Buttons, active states, glow effects |
| Primary text | `#ffffff` | Headlines, labels |
| Secondary text | `#94A3B8` | Descriptions, captions (8.3:1 contrast) |
| Muted text | `#718096` | Footer, legal copy (5.5:1 contrast — WCAG AA) |

**Glassmorphism cards:**

```css
.glass {
  background: rgba(255, 255, 255, .03);
  border: 1px solid rgba(255, 255, 255, .06);
  border-radius: 20px;
  backdrop-filter: blur(32px);
}
```

The low `background` opacity keeps the dark theme intact while `backdrop-filter: blur` adds perceived depth without a visible background color.

---

## JavaScript Patterns

All JavaScript is vanilla, inlined at the bottom of each page's `<body>`. No external libraries except D3.js (onboarding globe only).

**Shared patterns across all pages:**

```javascript
// Page exit fade
document.querySelectorAll('a[href]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    document.body.style.cssText = 'opacity:0;transition:opacity .22s ease;animation:none;';
    setTimeout(() => { window.location.href = href; }, 230);
  });
});

// Mobile menu toggle
function toggleMobileMenu() {
  const m = document.getElementById('mobile-menu');
  const b = document.getElementById('nav-hamburger');
  m.classList.toggle('open');
  b.classList.toggle('open');
  document.body.style.overflow = m.classList.contains('open') ? 'hidden' : '';
}
```
