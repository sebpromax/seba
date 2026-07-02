# Seba — The Operating System for Service Businesses

Seba is a SaaS platform built for independent professionals and small service companies — cleaning services, concierge companies, property management, maintenance contractors. It replaces the patchwork of spreadsheets, separate invoicing tools, calendar apps, and CRM systems with a single, focused workspace.

## The Problem

A typical service business runs on controlled chaos: proposals in one app, invoices in another, scheduling on paper, client communication scattered across WhatsApp and email. When the business grows, the chaos multiplies. Most "all-in-one" tools on the market are either too generic (Notion, Airtable) or too heavyweight (Salesforce, SAP).

Seba is built around a single insight: **the engine underneath every service business is identical** — clients, locations, appointments, prices, statuses. Only the visual "skin" changes between industries. This is what makes the platform scalable without bloating it with features nobody uses.

## Product Philosophy

> "10 features used every day beat 1,000 features rarely opened."

The dashboard answers three questions in under 30 seconds:

1. How much have I earned this month?
2. Who is working today, and where?
3. Which proposals or payments need my attention?

Everything else in the product flows from those three questions.

**Speed is not a feature — it is the product.** Creating a proposal: 30 seconds. Adding a client: 15 seconds. Generating an invoice: 10 seconds. The user must never wait.

## Design Philosophy

Seba's visual language is built on three hard constraints:

**1. No decoration.** Every element on screen exists because it serves a task. Dark background (`#0a0a0c`), a single green accent (`#00ff88`), white text. No gradients for their own sake.

**2. Typography as structure.** Headings carry weight (`font-weight: 800`, tight letter-spacing `−0.04em`), body text stays quiet. The typographic hierarchy guides the eye without visual noise.

**3. Performance as a design metric.** A page that loads in 100ms feels premium. A page that loads in 2 seconds feels broken. Lighthouse scores are treated with the same seriousness as color and layout — `system-ui` font stack (zero network round-trip), all critical CSS inlined, zero render-blocking scripts.

## Getting Started

This project is a static HTML/CSS/JS prototype — no build step, no dependencies to install.

```bash
# Clone the repository
git clone https://github.com/sebpromax/seba.git
cd seba

# Open directly in a browser
open docs/index.html

# Or serve locally for accurate performance testing
npx serve docs/
```

### File Structure

```
seba/
├── docs/                    # GitHub Pages root — the live site
│   ├── index.html           # Landing page
│   ├── onboarding.html      # Account creation wizard (8 steps)
│   ├── tarifs.html          # Pricing (Solo / Pro / Team / Enterprise)
│   ├── product.html         # Feature overview
│   ├── faq.html             # Resources and FAQ
│   ├── connexion.html       # Login page
│   ├── dashboard.html       # App prototype — main dashboard
│   ├── pro-global.css       # Shared CSS for app pages
│   └── [app pages]          # planning, devis, factures, clients, etc.
├── site/                    # Extended prototype pages (not GitHub Pages)
├── strategie/               # Vision and product strategy (not deployed)
│   ├── Seba-vision-strategie.md
│   └── plan-de-construction.md
└── README.md
```

## Current Status

This is an interactive prototype built to validate the product concept with real service professionals **before** building any backend. All interactions are client-side; no data is persisted between sessions.

**Next milestone:** User interviews with 30–50 professionals in the target niche (seasonal rental concierge services, cleaning companies) to validate the core workflow assumptions.

## Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| **V1** | CRM, scheduling, proposals, billing, Stripe, client portal | In design |
| **V2** | AI-assisted proposals, automated workflows, smart reporting | Planned |
| **V3** | Marketplace, mobile app, predictive analytics | Future |

> An excellent AI built on software nobody uses serves no purpose. We validate usage before adding intelligence.

---

*Seba is built with the conviction that simple, reliable tools beat complex ones — and that the best product is the one professionals open every morning out of habit.*
