# 🏗️ ARCHITECTURE.md — Blueprint cible "Tour de Contrôle"

*Rédigé le 2026-07-15, révisé le 2026-07-15 (deux passes) suite aux décisions du fondateur (voir `CHANGELOG.md`). Document de référence et de planification uniquement — **aucun fichier n'a été déplacé ou migré**, conformément à la consigne ("avant toute manipulation ou migration de fichiers"). `_architecture/` vit à la racine du dépôt, hors de `docs/` : GitHub Pages ne sert que `docs/`, donc ce dossier n'est jamais livré en production, quelle que soit sa profondeur.*

Ce document prolonge deux analyses déjà écrites à la racine du dépôt — `ARCHITECTURE-V2.md` (schéma de données, tokens de thème) et `ARCHITECTURE-MODULAIRE.md` (event bus, découplage) — sans les contredire. Voir la section 3 pour le point de recoupement le plus important.

---

## Décisions actées

1. **Pas de dossier `www/`.** `docs/` reste lui-même le dossier marketing — `index.html`, `tarifs.html`, `solution.html`, `faq.html`, etc. restent à sa racine. Élimine le risque de casser l'URL racine du site (`sebpromax.github.io/seba/`).
2. **Option A retenue pour la collision de noms.** `docs/src/` (event bus, Phases 1-2 de `ARCHITECTURE-MODULAIRE.md`) n'est pas touché. Le nouveau périmètre utilise des noms distincts : `ui/` → **`design-system/`**, `core/` → **`services/`**.
3. **`connexion.html` et `onboarding.html` restent à la racine publique de `docs/`.** Ce sont le "sas" public vers l'application — des portes d'entrée stratégiques pour l'acquisition, pas des vues internes. `docs/app/` est **strictement réservé aux vues post-login** (`dashboard.html`, `settings/`, et les pages déjà bloquées par `robots.txt` aujourd'hui : clients, client-fiche, devis, devis-nouveau, factures, planning, equipe, employe-fiche, historique). `app/` est la seule zone totalement bloquée par `robots.txt` et absente du sitemap — décision qui résout le point resté ouvert dans la révision précédente de ce document.

---

## 1. Arborescence cible (finale)

```text
docs/                            # 🌍 Racine = marketing + sas de conversion (100% SEO/indexable)
├── index.html                   # reste a la racine (aucun changement de chemin)
├── tarifs.html
├── solution.html
├── faq.html
├── connexion.html                # reste a la racine — porte d'entree publique, indexable
├── onboarding.html                # reste a la racine — porte d'entree publique, indexable
├── ... (toutes les autres pages marketing actuelles, a plat, comme aujourd'hui)
├── fonctionnalites/              # regroupement optionnel des pages SEO thematiques
├── blog/                         # 📈 SEO longue traine — V2/V3, pas prioritaire aujourd'hui
├── legal/                        # ⚖️ cgu.html, mentions-legales.html, politique-confidentialite.html
├── app/                          # 🧠 STRICTEMENT post-login — seule zone bloquee robots.txt + absente du sitemap
│   ├── dashboard.html
│   ├── clients.html, client-fiche.html, devis.html, devis-nouveau.html,
│   │   factures.html, planning.html, equipe.html, employe-fiche.html,
│   │   historique.html           # deja bloques par robots.txt aujourd'hui
│   └── settings/                 # reglages.html actuel
├── services/                     # ⚙️ (ex-"core/") — renomme pour eviter la collision avec docs/src/core/
│   ├── api/                      # auth.js, seba-data.js (deja les noms reels du projet)
│   ├── i18n/                     # ⚠️ n'existe pas aujourd'hui — V2/V3, voir section 3
│   └── utils/
├── design-system/                # 🎨 (ex-"ui/") — renomme pour eviter la collision avec docs/src/ui/
│   ├── styles/                   # pro-global.css + theme.css
│   ├── components/
│   └── assets/                   # favicon, icon-*.png, screenshots
├── src/                          # INCHANGE — event bus (core/modules/ui), Option A
├── robots.txt                    # Autorise la racine (dont connexion.html/onboarding.html), bloque uniquement /app/
└── sitemap.xml                   # Indexe la racine, dont connexion.html et onboarding.html — app/ absent
```

---

## 2. Ce qui existe déjà et fait doublon avec l'objectif de cette arborescence

`robots.txt` et `sitemap.xml` **appliquent déjà** la logique cible (bloquer les pages internes, indexer marketing + conversion), par motif d'URL plutôt que par dossier physique. La restructuration en `app/` apporte de la clarté pour les devs (humains et agents) et simplifie la maintenance du `robots.txt` (un seul préfixe `/app/` à bloquer, au lieu d'une liste page par page) — mais elle ne change pas ce qui est déjà indexé aujourd'hui : `connexion.html`/`onboarding.html` restent indexables exactement comme depuis la PR #78, sans qu'aucune URL canonique ni entrée sitemap n'ait besoin d'être réécrite pour elles.

`legal/` : les 3 pages existent déjà, en fichiers plats à la racine de `docs/`. Le contenu ne change pas, seul l'emplacement physique serait nouveau.

`docs/src/` (event bus, `ARCHITECTURE-MODULAIRE.md`) : **non touché**, conformément à l'Option A. Phase 3 (bascule réelle de `dashboard.html` sur l'event bridge) reste un chantier séparé, toujours non commencé.

---

## 3. Périmètre volontairement différé (aligné avec la feuille de route V1-first déjà actée)

- **`services/i18n/`** : Seba est 100% français aujourd'hui, aucune infrastructure de traduction n'existe. Documenté comme cible future, pas comme un manque à combler maintenant.
- **`blog/`** : SEO longue traîne, vrai levier à terme, mais suppose un moteur de contenu qui n'existe pas encore. À chiffrer séparément.

---

## 4. Ce que la migration réelle impliquerait (à ne pas sous-estimer)

Le périmètre réel de migration se limite désormais aux pages qui rejoignent `app/`, `services/`, `design-system/` — `index.html`, `tarifs.html`, `connexion.html`, `onboarding.html` et le reste de la racine marketing ne bougent pas.

- **Liens internes** touchant les pages déplacées : tout `href="dashboard.html"`, `href="reglages.html"` etc. présent sur une page de la racine (qui, elle, reste en place) devra être réécrit en `app/dashboard.html` etc.
- **Chemins d'assets relatifs** dans les pages déplacées (`pro-global.css`, `seba-data.js`, `auth.js` etc.) — deviennent `../design-system/styles/...`, `../services/api/...` et cassent sans `../` ajusté.
- **`robots.txt`/`sitemap.xml`** — simplifiable à un seul `Disallow: /app/` au lieu de la liste actuelle page par page ; `connexion.html`/`onboarding.html` n'ont besoin d'aucune modification puisqu'ils ne migrent pas.
- **Les scripts QA** (`scripts/qa-*.js`, `scripts/verify-*.js`) référençant `docs/dashboard.html`, `docs/clients.html`, `docs/reglages.html`, etc. en dur.

Toujours pas une opération en un commit — plusieurs PR atomiques, dossier par dossier, avec vérification de non-régression des liens à chaque étape.

---

## Statut

📋 **Blueprint finalisé pour son périmètre de décision, aucune migration commencée.** Prochaine étape suggérée : découper la migration en PR atomiques par dossier cible (`app/` d'abord, car il a le rayon d'impact le plus large et le plus simple à vérifier — 0 changement d'indexation attendu).
