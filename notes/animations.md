# Animation Strategy

## Core Principle

Every animation in Seba serves a functional purpose: it either orients the user spatially (where did this element come from?) or confirms an action (did my click register?). No animation exists purely for visual interest.

A secondary constraint: all animations must be GPU-compositable. We never animate properties that trigger layout recalculation (`width`, `height`, `top`, `left`, `margin`, `padding`). Only `transform` and `opacity` are animated — both are handled entirely by the compositor thread without involving the main thread or triggering layout/paint.

---

## Page Entry and Exit

### Entry: fade-in on load

```css
body {
  animation: pgFadeIn .35s ease both;
}

@keyframes pgFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
```

The `translateY(6px)` entry gives the page a subtle vertical "settling" motion that reads as content arriving rather than just blinking on. Duration: 350ms — fast enough to not delay access to content, long enough to register consciously.

### Exit: fade-out on navigation

```javascript
document.querySelectorAll('a[href]').forEach(a => {
  const href = a.getAttribute('href');
  if (href && !href.startsWith('#') && !href.startsWith('http') && !href.startsWith('mailto')) {
    a.addEventListener('click', e => {
      e.preventDefault();
      document.body.style.cssText = 'opacity:0;transition:opacity .22s ease;animation:none;';
      setTimeout(() => { window.location.href = href; }, 230);
    });
  }
});
```

**Why 230ms?** The CSS transition is 220ms. The 10ms buffer accounts for the event loop scheduling `setTimeout` with slight drift. Shorter timeouts cause the browser to navigate before the fade completes; longer timeouts make the transition feel sluggish.

**Why fade and not slide?** Sliding implies navigational hierarchy (forward/back, parent/child). Seba's pages are peers — Pricing, Product, and FAQ are siblings. A fade is directionally neutral; it does not imply a position in a hierarchy.

**Why `animation:none` on exit?** The body's `pgFadeIn` animation is active for 350ms after load. Without resetting it, if a user clicks a link within 350ms of the page loading, the browser would try to simultaneously run the entry animation and the exit transition, causing a conflict. Resetting to `none` ensures the exit is clean.

---

## Cursor Trail

```javascript
(function () {
  if (window.matchMedia('(hover: none)').matches) return;

  const t = document.createElement('div');
  t.id = 'cursor-trail';
  document.body.appendChild(t);

  let mx = 0, my = 0, tx = 0, ty = 0;

  document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });

  (function loop() {
    tx += (mx - tx) * 0.12;
    ty += (my - ty) * 0.12;
    t.style.transform = `translate(${tx - 5}px, ${ty - 5}px)`;
    requestAnimationFrame(loop);
  })();
})();
```

**Lerp factor 0.12:** The trail follows the real cursor at 12% of the remaining distance per frame. At 60fps, this means the trail reaches the cursor after approximately 8 frames (~133ms). Lower values (0.05) feel detached and slow; higher values (0.3+) feel mechanical and lose the smoothing effect.

**GPU path:** Only `transform` is mutated — the compositor handles this entirely off the main thread. No `top`/`left`, no layout recalculation on every `mousemove`.

**Mobile disabled via feature query:** `(hover: none)` detects touch-primary devices (phones, tablets). On these devices, there is no persistent cursor, and drawing a circle on every `touchmove` event would create visual noise without purpose.

---

## Button Interactions

### Primary CTA (`.btn-seba`)

```css
.btn-seba {
  transition: box-shadow .25s, transform .2s;
}

.btn-seba:hover {
  box-shadow: 0 0 28px rgba(0,255,136,.45), 0 0 60px rgba(0,255,136,.18);
  transform: translateY(-2px);
}
```

The `-2px` lift creates a physical sensation of the button rising to meet the cursor. The green glow ties the button's active state directly to the brand accent color, reinforcing visual consistency.

**Why different durations?** `transform: .2s` resolves slightly before `box-shadow: .25s`. This creates a micro-sequencing effect: the button lifts first, then the glow arrives — a "press and illuminate" reading rather than everything changing in unison.

**Note on `box-shadow`:** Unlike `transform` and `opacity`, `box-shadow` triggers a paint operation (not a composite). On modern hardware this is imperceptible for a single element, but `box-shadow` should not be animated on elements that repeat dozens of times per page.

### Ghost / Outline Button (`.btn-seba-outline`)

```css
.btn-seba-outline {
  transition: border-color .2s, background .2s, box-shadow .25s, transform .2s;
}

.btn-seba-outline:hover {
  border-color: rgba(0,255,136,.5);
  color: #00ff88;
  background: rgba(0,255,136,.04);
}
```

A subtler interaction: border and text shift to green, background adds a near-invisible tint. No lift (`translateY`) — the outline button is secondary, and its hover should feel less emphatic than the primary CTA.

---

## Glassmorphism Cards

```css
.glass {
  backdrop-filter: blur(32px);
  -webkit-backdrop-filter: blur(32px);
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.06);
}
```

`backdrop-filter: blur()` is GPU-composited. It creates a frosted-glass effect by blurring whatever is rendered behind the element, at the compositor level. This is not animated — it is a static property. Animating `blur()` radius would cause repaints on every frame and should be avoided.

**Why not `will-change: transform` globally?** `will-change` creates a new compositing layer for the element, which costs GPU memory and VRAM bandwidth. Applied to every card on a page, it would create 10–20 extra compositing layers with no benefit. It is only set on elements that are known to animate (e.g., the cursor trail).

---

## D3.js Globe (Onboarding Step 0)

```javascript
const W = 540, H = 540, R = 252;

const projection = d3.geoOrthographic()
  .scale(R)
  .translate([W / 2, H / 2])
  .clipAngle(90);

let rotation = 0;

function animate() {
  projection.rotate([rotation += 0.15, -20]);
  // redraw SVG paths
  requestAnimationFrame(animate);
}
```

**Why SVG and not Canvas?** At 540×540px with ~50 country paths, SVG renders without perceptible performance cost. Canvas would reduce memory usage and increase throughput for complex scenes (thousands of paths, particle systems), but adds implementation complexity with no measurable benefit at this scale.

**Rotation speed — 0.15°/frame:** At 60fps, the globe completes one full rotation in approximately 40 seconds. Fast enough to communicate that it's live, slow enough that users can read the continental shapes without motion sickness.

**Tilt — `−20°`:** The constant `-20` tilt on the Y axis ensures the globe shows primarily landmasses rather than polar ice. It also adds visual interest by showing the Earth at the angle most recognizable from satellite imagery.

**`requestAnimationFrame`:** Automatically pauses when the browser tab is hidden (via the Page Visibility API), preserving battery life on mobile. It syncs with the display's refresh rate — no fixed `setInterval` timer that would drift or double-fire at high refresh rates.

---

## Mobile Menu Overlay

```css
.mobile-menu {
  opacity: 0;
  pointer-events: none;
  transition: opacity .3s;
}

.mobile-menu.open {
  opacity: 1;
  pointer-events: auto;
}
```

**Why `opacity` not `display`?** `display: none → flex` cannot be transitioned — the browser applies the change instantly with no interpolation. `opacity: 0 → 1` is compositable and transitions smoothly.

**Why `pointer-events: none`?** An invisible element with `opacity: 0` is still present in the DOM and still receives click/touch events. Without `pointer-events: none`, the invisible menu would intercept taps on the page behind it — invisible but interactive, which is a serious usability and accessibility bug.

**Scroll lock on open:**

```javascript
document.body.style.overflow = menu.classList.contains('open') ? 'hidden' : '';
```

When the menu is open, the body scroll is locked. Without this, users on mobile can scroll the page content behind the overlay, which creates a disorienting double-scroll experience.

---

## Performance Summary

| Animation | Property animated | GPU composited | Layout triggered |
|-----------|-------------------|---------------|-----------------|
| Page fade-in | `opacity`, `transform` | Yes | No |
| Page fade-out | `opacity` | Yes | No |
| Cursor trail | `transform` | Yes | No |
| Button hover | `transform`, `box-shadow` | Partial | No |
| Mobile menu | `opacity` | Yes | No |
| D3 globe | SVG path `d` attribute | No (paint) | No |

The D3 globe path redraws on every frame are paint operations, not composite operations. This is acceptable because the globe is isolated to a single step in the onboarding flow and is the only animating element on screen when visible.
