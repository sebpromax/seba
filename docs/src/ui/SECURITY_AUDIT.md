# SECURITY_AUDIT.md — Éléments de télémétrie non protégés (dashboard.html)

*Audit du 2026-07-09, en préparation de la migration Télémétrie → UI (mission en 4 prompts). Aucune correction appliquée à ce stade — audit seul, conformément à la consigne du Prompt 1.*

## Résumé

Sur les 6 éléments recensés dans `telemetry-map.json`, **aucun n'injecte lui-même de donnée non échappée** — tous utilisent `textContent` ou `style.width` (auto-sécurisés par nature, pas de risque HTML). En revanche, l'audit a mis au jour un problème réel **connexe**, dans la même fonction que l'élément `#notif-badge` :

## 🔴 Finding — `renderNotifPanel()` insère `c.client` non échappé (dashboard.html)

**Localisation** : `docs/dashboard.html`, fonction `renderNotifPanel(ctx)` (~ligne 1938).

```javascript
body.innerHTML = late.slice(0, 5).map(c =>
  '<a href="contentieux-recouvrement.html" class="notif-item">' +
    '<span>Facture en retard — ' + c.client + '</span>' +
    ...
```

`c.client` provient de `ctx.creances` (`docs/widgets.js:44`, `readSeba('creances_imp', [])`) — des données de créances construites à partir des vrais enregistrements clients de l'utilisateur (même origine que `clients.html`/`equipe.html`, où le même type de faille a déjà été corrigé dans les PR #18/#19). Un nom de client contenant du HTML/JS (entré via le formulaire client, ou un import CSV non filtré — `docs/import-export.js`) s'exécuterait ici sans être neutralisé.

**Aggravant** : `docs/dashboard.html` **n'a aucune fonction `esc()` locale** — contrairement à `clients.html`/`crm-tech.html`/`widgets.js` qui en ont chacun une copie. Ce fichier n'a donc jamais eu le réflexe de protection disponible en interne ; il faudrait importer `docs/src/core/esc.js` (déjà créé, PR #21) pour corriger proprement, plutôt que dupliquer une 4ᵉ copie.

**Ce finding n'est pas corrigé dans ce prompt** (instruction explicite : ne modifier aucun fichier existant) — à traiter soit dans une correction de sécurité dédiée, soit à l'occasion de la migration Télémétrie si `#notif-badge`/le panneau de notifications entre dans son périmètre.

## Éléments du périmètre télémétrie — statut sécurité

| Élément | Assignation | Risque |
|---|---|---|
| `#focus-score-num` | `textContent` avec un nombre (`computeSerenityScore`) | Aucun — valeur toujours numérique |
| `#focus-score-lbl` | `textContent` avec un libellé interne fixe (`serenityStateFor().label`) | Aucun — jamais de donnée utilisateur libre |
| `#notif-badge` | `textContent` avec un nombre ou `'9+'` | Aucun |
| `#wc-bar` | `style.width` avec un pourcentage calculé | Aucun |
| `#wc-pct` | `textContent` avec un texte du type `"2 / 3"` | Aucun |
| `#cockpit-telemetry` | Conteneur du système de widgets (`widgets.js`) | **Hors périmètre de cet audit** — chaque widget gère son propre échappement (ou non) dans son `def.render()` ; un audit dédié de `WIDGET_CATALOG` serait nécessaire pour statuer widget par widget, pas fait ici |

## Recommandation pour les prompts suivants

Quand `ui-controller.js` recevra la consigne d'utiliser `esc()` systématiquement (Prompt 2), il n'y aura **rien à corriger côté échappement** pour les 5 éléments listés ci-dessus (déjà sûrs par construction — nombres/pourcentages) : l'usage d'`esc()` y sera une **garantie défensive** plutôt qu'un correctif d'une faille active. Le vrai correctif de sécurité (`renderNotifPanel`/`c.client`) reste un chantier à part, non couvert par le périmètre de cette migration telle que définie dans les 4 prompts.
