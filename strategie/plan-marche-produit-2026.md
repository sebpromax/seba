# Seba — Analyse concurrentielle, avis produit et plan d'exécution (juillet 2026)

## 1. La concurrence — ce qu'on affronte réellement

### Les géants américains (field service management)
| Acteur | Prix | Forces | Faiblesses exploitables |
|---|---|---|---|
| **Jobber** | 49–249 $/mois (+19–29 $/utilisateur) | Interface simple, routing intégré, apps mobiles iOS/Android solides | Support lent, app mobile parfois lente, **faible en France** (anglo-centré, pas de conformité facture FR) |
| **Housecall Pro** | 79–329 $/mois | Automatisations marketing, paiement même jour (Instapay), "AI Team" qui réserve des jobs, site web inclus | Cher, interface mobile moins intuitive, **pas localisé FR** |
| **ServiceTitan** | Très cher (entreprise) | Le plus complet, app technicien de référence | Inaccessible aux TPE — hors de notre cible |

### Le marché français (fragmenté en mono-niches)
- **Conciergerie Airbnb** : MrSherlock, Jana, Yaago, Hostiaa — simples, pas chers, mais **uniquement** location courte durée (sync calendriers, messages voyageurs).
- **Nettoyage/ménage pro** : Taskaim, CleanGuru — gestion opérationnelle du nettoyage, devis d'appels d'offres.
- **Constat clé** : personne en France ne couvre **plusieurs métiers de services avec un seul moteur**. C'est exactement le pari de Seba (moteur commun + peau par métier). Les outils FR sont mono-niche, les outils US sont multi-métiers mais pas localisés. **La case "multi-métiers × français" est vide.**

### Ce que le marché attend d'une app terrain en 2026 (standard, non négociable)
- **Offline d'abord** : le technicien travaille en cave/parking sans réseau — non négociable en 2026.
- App technicien : planning du jour, navigation GPS, photos avant/après, signature client, pointage, encaissement sur place.
- **Portail client self-service** : réserver, suivre l'arrivée en temps réel, approuver devis, payer — réduit les appels entrants.
- IA en plus (pas en socle) : planification auto, optimisation de tournées (-35 % de route), diagnostic photo.

## 2. Mon avis franc sur Seba aujourd'hui

### Ce que j'aime (et qu'il faut protéger)
1. **La vision "OS des services"** — moteur commun (clients/RDV/prix/statuts) + peau par métier. C'est structurellement plus scalable que les mono-niches FR et plus localisé que les US. La vraie différenciation.
2. **Le dashboard modulaire à widgets** (drag-and-drop, tailles fixes, barre IA) — aucun concurrent FSM ne fait ça. Garde de l'avance.
3. **L'onboarding** — 8 étapes cinématiques, meilleur que celui de Jobber. C'est un argument de vente en soi ("créez votre espace en 5 minutes").
4. **La discipline produit** ("10 fonctionnalités quotidiennes, pas 1000") — c'est écrit dans la stratégie ; il faut s'y tenir (voir point faible n°2).
5. **La qualité d'exécution visuelle** — niveau au-dessus du marché FR.

### Ce que je n'aime pas (dit honnêtement)
1. **Tout est encore une démo localStorage.** Zéro backend, zéro vraie donnée, zéro vrai compte. Le fossé entre "site magnifique" et "produit qu'un client paie" est là, pas dans le design. Un pro qui perd ses données en vidant son navigateur ne revient jamais.
2. **39 pages dont ~16 pages-outils** (trésorerie, FEC, PPSPS, écotaxe, crypto-backup…) — impressionnantes mais dispersées. Ça contredit frontalement l'obsession n°1. Un prospect qui explore se noie. Je les regrouperais derrière un menu "Modules avancés" ou les retirerais de la nav jusqu'à la V2.
3. **La validation terrain n'a jamais eu lieu.** Le plan de construction la prévoit (30–50 interviews) — c'est LE risque n°1 : on a construit énormément sur hypothèses. Chaque semaine de dev sans parler à un client réel augmente le risque de construire à côté.
4. **Pas de brique paiement/facture réelle.** En France, une facture doit être conforme (mentions, TVA, numérotation) — c'est la première chose qu'un artisan attend, et c'est ce que Jobber/HCP ne font pas bien en FR. Opportunité et manque à la fois.
5. **Pas de présence mobile installable.** Le FSM se vit sur le terrain ; sans app (même PWA), pas d'usage quotidien réel.
6. Détail : la vitrine est dark, l'app est light — assumable (Stripe fait pareil), mais à trancher consciemment un jour.

### Ce que je ferais à ta place (l'ordre qui compte)
**Vendre avant de coder plus.** Le prototype est assez bon pour être montré. La suite du dev doit être dictée par ce que disent 15–30 vrais pros, pas par nos idées (même bonnes).

## 3. LE PLAN — à suivre sans s'arrêter

### Phase A — Validation terrain (semaines 1–3, coût : 0 €)
1. Figer le site actuel comme **démo commerciale** (il est prêt).
2. Préparer un script d'entretien de 10 questions (journée type, outils actuels, ce qui fait perdre temps/argent, prix acceptable).
3. Contacter 30 pros (ménage + conciergerie en priorité — terrain connu) : 15 entretiens minimum, démo du site à l'appui.
4. Sortie de phase : **3 engagements** ("je paierais X €/mois pour ça") ou pivot des priorités selon les retours.

### Phase B — Le vrai socle (semaines 3–8)
1. **Backend minimal** : Supabase (auth email + base Postgres + API) — pas de serveur à gérer, gratuit au début.
2. Brancher les pages existantes (clients, devis, factures, planning) sur de vraies données — le front est déjà prêt, c'est "juste" le câblage.
3. **Auth réelle** sur connexion.html + onboarding (le formulaire étape 8 existe déjà).
4. Sortie de phase : un pro crée son compte, ajoute un client, fait un devis — et retrouve tout le lendemain sur un autre appareil.

### Phase C — La première valeur facturable (semaines 8–12)
1. **Stripe** : encaissement des factures par lien de paiement (la page l'affiche déjà en démo).
2. **Factures PDF conformes France** : mentions légales, TVA, numérotation séquentielle — l'arme anti-Jobber.
3. Portail client réel (seba.app/p/slug) : le client voit ses RDV/factures, paie en ligne.
4. Sortie de phase : **premier client payant** (même 19 €/mois). C'est le vrai jalon V1.

### Phase D — Mobile (semaines 12–16)
1. **PWA d'abord, pas d'app native** : le site pro devient installable (manifest + service worker), planning du jour offline, photos avant/après, signature tactile (le canvas existe déjà dans signature-payment.html).
2. App native (iOS/Android) seulement après validation d'usage de la PWA — conforme à la roadmap V3.

### Phase E — L'IA visible (après premiers clients payants — V2 assumée)
1. La barre IA du dashboard passe de simulée à réelle (elle est déjà câblée — il ne manque que l'appel API).
2. Relances automatiques intelligentes, résumé hebdo du CA — les cas d'usage validés par les interviews de la Phase A.

### Règles transverses (tout le long)
- Le site vitrine ne bouge plus sauf retours clients — il est bon.
- Les 16 pages-outils sortent de la navigation principale (menu "Modules avancés") dès le début de la Phase B.
- Chaque phase se termine par une vérification réelle (headless + test manuel) avant push — méthode déjà en place.

## Sources
- [Jobber vs Housecall Pro (getjobber.com)](https://www.getjobber.com/comparison/jobber-vs-housecall-pro/) · [Comparatif FieldPulse](https://www.fieldpulse.com/resources/blog/housecall-pro-vs-jobber) · [SelectHub 2026](https://www.selecthub.com/field-service-software/jobber-vs-housecall-pro/) · [Teardown Tradesly 2026](https://www.tradesly.ai/blog/housecall-pro-vs-jobber-comparison-small-business-2026)
- [Logiciel conciergerie — guide 2026 (Welkomz)](https://www.welkomz.com/2026/02/03/logiciel-conciergerie/) · [PriceLabs — choisir ses outils](https://hello.pricelabs.co/fr/blog/logiciel-de-conciergerie-comment-choisir-les-bons-outils-pour-gerer-vos-locations-saisonnieres/) · [Appvizer conciergerie](https://www.appvizer.com/services/concierge) · [Hostcare — outils indispensables](https://hostcarefrance.fr/magazine/conciergerie/se-lancer-dans-la-conciergerie-les-outils-indispensables-pour-bien-demarrer)
- [Features FSM 2026 (GenicTeams)](https://www.genicteams.com/field-service-management-app-must-have-mobile-features-for-technicians/) · [IA dans le FSM (TechRev)](https://www.techrev.us/blog/ai-in-field-service-management/) · [App technicien ServiceTitan](https://www.servicetitan.com/features/field-mobile-app) · [Dév mobile FSM 2026 (Wednesday)](https://mobile.wednesday.is/writing/mobile-development-us-field-service-companies-2026)
