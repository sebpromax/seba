# Deployment

## Overview

Seba is deployed as a static site via **GitHub Pages**, served directly from the `docs/` directory on the `main` branch. There is no CI/CD pipeline, no build step, no server-side rendering. Every file served is the exact file committed to the repository.

**Live URL:** `https://sebpromax.github.io/seba/`

---

## Deployment Workflow

### Publishing a Change

```bash
# 1. Edit files in docs/
# 2. Stage specific files (avoid git add -A, which can catch unintended files)
git add docs/index.html

# 3. Commit with a descriptive message following the convention below
git commit -m "UI: Reorder sections for better narrative flow"

# 4. Push — GitHub Pages deploys automatically within 30–60 seconds
git push origin main
```

No deployment command, build script, or server restart is needed. GitHub detects the push to `main` and republishes automatically.

### Verifying a Deployment

After pushing, check the deployment status at:
`https://github.com/sebpromax/seba/actions` (or `Settings → Pages` if Actions are not enabled)

The live site will reflect the change once the green checkmark appears — typically within 60 seconds of push.

---

## GitHub Pages Configuration

The site is served from:

| Setting | Value |
|---------|-------|
| Source branch | `main` |
| Source directory | `/docs` |
| Build | None (static) |

To verify or change this: `Repository → Settings → Pages → Source`.

All files inside `docs/` are publicly accessible at their path relative to the root. For example, `docs/tarifs.html` is served at `https://sebpromax.github.io/seba/tarifs.html`.

---

## Commit Message Convention

```
type: short description (under 72 characters)
```

| Type | When to use |
|------|-------------|
| `feat` | New page or significant new capability |
| `UI` | Visual changes — layout, color, spacing, typography |
| `Perf` | Performance improvements (LCP, CLS, blocking resources) |
| `fix` | Bug correction |
| `Cleanup` | Removing dead code, unused scripts, deprecated patterns |
| `Docs` | Documentation only — no code changes |
| `A11y` | Accessibility improvements |

**Examples from this project:**

```
UI: Add clear titles to Bento cards for better readability and structure
UI: Reorder sections — place Bento feature cards directly under Dashboard
Perf: Remove Google Fonts network dependency, switch to system-ui font stack
Cleanup: Remove faulty Weglot script, set lang='fr' for native browser translation
A11y: Fix low-contrast footer text #4B5563 → #718096 (2.7:1 → 5.5:1)
```

Commit messages should describe **why** the change was made, not just what changed. "Fix low-contrast footer text" tells the reader what changed; adding the contrast ratios tells them why it mattered.

---

## Performance Monitoring — Lighthouse

Lighthouse (built into Chrome DevTools) is the primary tool for measuring and tracking page quality. Run it on the deployed GitHub Pages URL, not on `localhost`, for results that reflect real network conditions.

### Running an Audit

1. Open Chrome and navigate to the deployed page
2. Open DevTools: `F12` or `Cmd+Option+I`
3. Select the **Lighthouse** tab
4. Settings: **Mobile**, all four categories checked
5. Click **Analyze page load**

Always test on **Mobile** — it simulates a mid-tier Android device on a throttled 4G connection, which is the most demanding real-world scenario and the one Lighthouse weights most heavily.

### Target Scores

| Category | Target | What it measures |
|----------|--------|-----------------|
| **Performance** | ≥ 95 | Load speed on a mobile 4G connection |
| **Accessibility** | ≥ 95 | Readability for all users, including assistive technology |
| **Best Practices** | ≥ 95 | Secure, modern, no console errors |
| **SEO** | ≥ 95 | Discoverability by search engines |

### Core Web Vitals

**LCP — Largest Contentful Paint** (target: < 2.5s)

The LCP element is the H1 headline on the landing page. Keeping it fast requires:
- Zero render-blocking scripts in `<head>` (no synchronous `<script>` or blocking `<link rel="stylesheet">`)
- System font stack — `system-ui` renders instantly with zero network requests
- Critical CSS inlined in `<style>` tags, not loaded from external files

**CLS — Cumulative Layout Shift** (target: < 0.1)

Avoid layout shifts by:
- Setting explicit `width` and `height` on all images
- Never injecting content above existing content after page load
- Using CSS `min-height` on sections that receive dynamic content

**INP — Interaction to Next Paint** (target: < 200ms)

Keep the main thread clear:
- No long-running synchronous JavaScript
- Event listeners should be lightweight (the cursor trail loop runs on `requestAnimationFrame`, not `mousemove`)

---

## Diagnosing Common Issues

| Symptom | Most likely cause | Fix |
|---------|------------------|-----|
| LCP > 5s | External font loading (Google Fonts) with slow CDN | Use `system-ui` font stack, or add `&display=swap` and `media="print" onload` pattern |
| LCP > 10s | Render-blocking script in `<head>` | Add `defer` attribute, or move script to end of `<body>` |
| LCP > 30s | External script 404 / timeout | Remove the script tag entirely |
| Accessibility < 90 | Low contrast text | Ensure ≥ 4.5:1 contrast ratio for body text (WCAG AA) |
| Best Practices < 90 | 404 errors in browser console | Remove or fix broken script/resource references |
| SEO < 90 | Missing `lang` attribute | Set `<html lang="fr">` on every page |
| SEO < 90 | Missing meta description | Add `<meta name="description" content="...">` in `<head>` |

---

## WCAG 2.1 Contrast Reference

All text on Seba meets WCAG 2.1 Level AA against the dark background (`#0a0a0c`):

| Color token | Hex / value | Usage | Contrast ratio | Level |
|-------------|-------------|-------|---------------|-------|
| White | `#ffffff` | Headlines, body | 21.0 : 1 | AAA |
| Secondary | `#94A3B8` | Descriptions, captions | 8.3 : 1 | AAA |
| Muted | `#718096` | Footer, legal copy | 5.5 : 1 | AA |
| Mobile links | `rgba(255,255,255,.6)` | Mobile menu | 6.4 : 1 | AA |
| Accent green | `#00ff88` | CTA, active states | 9.8 : 1 | AAA |

**Never use** `#4B5563` on `#0a0a0c` — this combination yields a 2.7:1 ratio and fails WCAG AA for body text. Use `#718096` as the minimum for muted copy.

---

## Multi-Page Consistency Checklist

When adding a new page, verify the following are present in `<head>`:

```html
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<html lang="fr">
<meta name="description" content="...">
<link rel="icon" type="image/jpeg" href="favicon.jpg">
```

And in `<body>`, before `</body>`:

```javascript
// Page exit fade
document.querySelectorAll('a[href]').forEach(a => { /* ... */ });

// Mobile menu toggle
function toggleMobileMenu() { /* ... */ }
function closeMobileMenu() { /* ... */ }

// Cursor trail
(function () { /* ... */ })();
```

These four scripts are the baseline for a consistent Seba page experience. Any page missing them will feel disconnected from the rest of the site.
