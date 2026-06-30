Bloc — Fiche client adaptée par métier (version détaillée).

CONTEXTE
client-fiche.html affiche actuellement :
- Un en-tête (nom, statut, email, téléphone)
- Un bloc "Informations" générique (adresse, date du premier contact, notes libres)
- Un historique des interventions
- Un bloc "Devis & Factures liés"
- Des actions rapides

Ce bloc "Informations" est identique pour tous les clients, quel que soit 
le secteur d'activité de l'entreprise. On veut ajouter un bloc 
supplémentaire, spécifique au métier, juste après le bloc "Informations" 
existant — SANS toucher au reste de la page.

OBJECTIF DÉTAILLÉ

1. Charger businessTypes.js
   Ajouter <script src="businessTypes.js"></script> dans client-fiche.html, 
   avant le script principal de la page (même emplacement que dans 
   dashboard.html pour rester cohérent).

2. Variable de secteur
   Ajouter en haut du script principal :
   // À remplacer par la valeur réelle issue de l'onboarding quand la
   // persistance inter-pages sera en place (localStorage, URL param, etc.).
   const currentSector = 'menage';
   (Exactement le même commentaire et la même logique que dans 
   dashboard.html, pour rester cohérent dans tout le projet.)

3. Nouveau bloc HTML "Informations métier"
   - Titre du bloc : génère-le dynamiquement à partir du label du secteur, 
     ex. "Informations ménage", "Informations conciergerie", 
     "Informations jardinage", "Informations maintenance"
   - Le bloc doit avoir le même conteneur visuel (même classe de carte/
     panel) que le bloc "Informations" déjà existant, pour qu'ils 
     s'enchaînent visuellement de façon cohérente
   - À l'intérieur, afficher chaque champ de 
     businessTypes[currentSector].clientFields sous forme de ligne 
     "label : valeur", dans le même format visuel que les lignes du bloc 
     "Informations" existant (réutilise exactement les mêmes classes CSS)

4. Valeurs de démonstration à utiliser précisément (ne pas inventer 
   autre chose, utilise exactement ces valeurs pour chaque champ) :

   SECTEUR MENAGE (champs : fréquence, surface, animaux, produits 
   préférés, pièces sensibles, code d'accès, consignes, photos 
   avant/après) :
   - Fréquence : "Toutes les 2 semaines"
   - Surface : "75 m², 3 pièces"
   - Animaux : "1 chat (litière à éviter le vendredi)"
   - Produits préférés : "Produits écologiques uniquement"
   - Pièces sensibles : "Bureau — ne pas déplacer les papiers"
   - Code d'accès : "Boîte à clés — code 4471"
   - Consignes : "Sonner deux fois, le chat peut sortir"
   - Photos avant/après : "4 photos disponibles (dernière visite)"

   SECTEUR CONCIERGERIE (champs : logement, propriétaire, voyageurs, 
   check-in, check-out, linge, clés, inventaire, rapport propriétaire) :
   - Logement : "Studio Bellecour, 3e étage, sans ascenseur"
   - Propriétaire : "M. et Mme Avril (contact secondaire)"
   - Voyageurs : "2 adultes — séjour de 4 nuits"
   - Check-in : "16h00 — code autonome"
   - Check-out : "10h00"
   - Linge : "Kit 2 personnes — change à chaque séjour"
   - Clés : "Boîte à clés sécurisée, façade"
   - Inventaire : "Vérifié le 18 juin — complet"
   - Rapport propriétaire : "Envoyé automatiquement après chaque séjour"

   SECTEUR JARDINAGE (champs : surface extérieure, fréquence, accès 
   jardin, déchets verts, matériel nécessaire, saisonnalité, photos) :
   - Surface extérieure : "320 m² avec haie périphérique"
   - Fréquence : "Mensuelle, toute l'année"
   - Accès jardin : "Portillon latéral — code 0892"
   - Déchets verts : "Évacuation incluse"
   - Matériel nécessaire : "Tondeuse + taille-haie électrique"
   - Saisonnalité : "Intervention renforcée mars à octobre"
   - Photos : "3 photos disponibles (dernière intervention)"

   SECTEUR MAINTENANCE (champs : problème signalé, diagnostic, photos 
   client, matériel à prévoir, urgence, rapport d'intervention) :
   - Problème signalé : "Fuite sous l'évier de la cuisine"
   - Diagnostic : "Joint à remplacer — confirmé sur place"
   - Photos client : "2 photos envoyées par le client"
   - Matériel à prévoir : "Joint plomberie + clé à sangle"
   - Urgence : "Non — intervention sous 48h"
   - Rapport d'intervention : "À rédiger après passage"

   SECTEUR PRESSING et SECTEUR AUTRE :
   - clientFields est vide pour ces deux secteurs → ne pas générer le 
     bloc du tout (ni titre, ni conteneur vide). Le bloc "Informations" 
     générique existant reste seul, sans bloc supplémentaire après lui.

5. Logique technique attendue
   - Écris une fonction JS, ex. renderSectorInfo(), qui :
     a. Lit businessTypes[currentSector].clientFields
     b. Si le tableau est vide, ne fait rien (n'insère aucun élément 
        dans le DOM)
     c. Sinon, génère le bloc HTML avec le titre et les lignes label/
        valeur, et l'insère juste après le bloc "Informations" existant
   - Les valeurs de démonstration listées au point 4 doivent être 
     stockées dans une structure JS clairement identifiable (ex. un 
     objet DEMO_CLIENT_FIELDS organisé par secteur puis par nom de 
     champ), pas codées en dur dans des chaînes de template imbriquées 
     difficiles à relire
   - Appelle cette fonction au chargement de la page (DOMContentLoaded 
     ou équivalent à ce qui est déjà utilisé ailleurs dans le fichier)

CONTRAINTES
- Ne modifie que client-fiche.html. Ne touche à aucun autre fichier, y 
  compris businessTypes.js (lecture uniquement)
- Ne casse aucune partie existante de la page : en-tête, bloc 
  Informations original, historique des interventions, devis/factures 
  liés, actions rapides doivent rester exactement comme avant
- Respecte le design system déjà en place (variables CSS, polices, 
  couleurs) — aucune nouvelle couleur ou police introduite
- Le code doit rester lisible : commente la fonction renderSectorInfo() 
  pour expliquer ce qu'elle fait

VALIDATION PRÉCISE
1. Avec currentSector = 'menage' (valeur par défaut), je dois voir un 
   bloc "Informations ménage" avec exactement les 8 lignes listées 
   ci-dessus, dans cet ordre, avec ces valeurs exactes
2. Je change la valeur à 'conciergerie' dans le code, je recharge la 
   page : le bloc devient "Informations conciergerie" avec les 9 lignes 
   correspondantes
3. Je teste aussi 'jardinage' et 'maintenance' : même comportement avec 
   les bonnes valeurs
4. Je teste 'pressing' : aucun bloc supplémentaire n'apparaît du tout, 
   la page s'arrête proprement après le bloc "Informations" générique
5. À aucun moment le reste de la page (historique, devis/factures, 
   actions rapides) ne change ou ne se déplace de façon inattendue
