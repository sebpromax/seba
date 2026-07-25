/* ═══════════════════════════════════════════════════════════════
   SEBA DATA ENGINE — couche de données unifiée du site pro.
   Une seule source de vérité pour clients, devis, factures,
   interventions, employés et journal d'activité.

   Architecture en adaptateurs :
   - LocalAdapter (défaut)   : localStorage['seba_db'], zéro dépendance.
   - SupabaseAdapter (option): activé si window.SEBA_CONFIG.supabaseUrl
     et .supabaseAnonKey sont définis (voir docs-backend.md). Le reste du
     code ne change pas.

   Synchronisation cloud (Palier 1, VISION-TECHNIQUE-SEBA-PHASE2-CADRAGE.md) :
   create()/update()/remove()/log() écrivent TOUJOURS en local en premier
   (state reste la projection synchrone lue par toutes les pages), PUIS
   mettent en file un patch delta (localStorage['seba_pending_ops']) au
   lieu de pousser tout le blob seba_state d'un coup. Un worker debouncé
   vide cette file vers l'Edge Function sync-push.ts, qui applique chaque
   patch de façon atomique (apply_entity_patch, verrouillage par ligne
   côté Postgres). N'existe que si Supabase est configuré ET qu'une
   session existe -- en mode local pur ou anonyme, aucune file, aucun
   réseau, comportement rigoureusement identique à avant.

   API :
     SebaDB.ready()                    -> init + seed si première visite
     SebaDB.list(coll)                 -> tableau (copie)
     SebaDB.get(coll, id)
     SebaDB.create(coll, obj)          -> obj avec id
     SebaDB.update(coll, id, patch)
     SebaDB.remove(coll, id)
     SebaDB.log(type, label, href)     -> entrée de journal
     SebaDB.journal(limit)
     SebaDB.metrics()                  -> chiffres calculés (CA, compteurs)
     SebaDB.nextNum('devis'|'facture') -> '#0125' / '#F-0099'
     SebaDB.onChange(fn)               -> écoute (même page + autres onglets)
     SebaDB.exportJSON() / importJSON(str)
     SebaDB.eraseAllData()             -> efface tout (local + ligne cloud), Art. 17 RGPD
     SebaDB.hasData()                  -> vrai si le compte a des données
     SebaDB.messages.list(filter) / .send(obj)  -> async, table seba_messages dédiée
     -- Authentification universelle (2026-07-19) : patron/employé/client
     -- suivent tous les trois le même modèle (vraie session Supabase Auth
     -- indépendante, provisionnée par invitation) --
     SebaDB.employeePortal.provision(employeId, email)          -> async, Edge Function employe-provision.ts (invitation)
     SebaDB.employeePortal.login/logout/session/profile/setPassword()  -> async, RPC get_my_employee_profile
     SebaDB.employeePortal.interventionsForDate(date)           -> async, RPC get_my_employee_interventions (planning du jour)
     SebaDB.employeePortal.closeIntervention(id, rapport, photoPath) -> async, RPC close_my_intervention (clôture de mission)
     SebaDB.clientPortal.provision(clientId, email)             -> async, Edge Function client-provision.ts (invitation)
     SebaDB.clientPortal.login/logout/session/profile/setPassword()  -> async, RPC get_my_client_profile
     SebaDB.clientPortal.requests.list/create/update()          -> async, table client_requests dediee
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const DB_KEY = 'seba_db';
  const EMPTY = () => ({
    v: 1,
    clients: [], devis: [], factures: [], interventions: [], employes: [], journal: [],
    custom_services: [], contrats: [], messages: [], clientRequests: [],
    seq: { devis: 118, facture: 93, contrat: 0 },
  });

  /* ── Adaptateur localStorage (défaut) ── */
  const LocalAdapter = {
    name: 'local',
    load() {
      try { const d = localStorage.getItem(DB_KEY); return d ? JSON.parse(d) : null; }
      catch (e) { return null; }
    },
    save(state) {
      try { localStorage.setItem(DB_KEY, JSON.stringify(state)); } catch (e) {}
    },
  };

  /* ── Adaptateur Supabase (optionnel — voir docs-backend.md) ──
     Persiste l'état dans la table seba_state (une ligne par compte).
     Chargement au démarrage, sauvegarde débouncée après chaque écriture.
     localStorage reste le cache local (lecture instantanée, offline). */
  const SupabaseAdapter = {
    name: 'supabase',
    _pending: null,
    load() { return LocalAdapter.load(); }, // cache local immédiat
    /* Jeton de la session utilisateur (posé par supabase-js dans
       localStorage 'sb-<ref>-auth-token') : indispensable pour passer
       les policies RLS (auth.uid() = user_id). Sans session → la clé
       publique seule, et RLS refusera l'écriture : c'est voulu. */
    _bearer() {
      const cfg = window.SEBA_CONFIG;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (/^sb-.*-auth-token$/.test(k)) {
            const tok = JSON.parse(localStorage.getItem(k));
            if (tok && tok.access_token) return tok.access_token;
          }
        }
      } catch (e) {}
      return cfg.supabaseAnonKey;
    },
    /* Identifiant de compte réel = auth.uid() de l'utilisateur connecté,
       extrait directement du JWT déjà stocké par supabase-js (même jeton
       que _bearer() ci-dessus) — synchrone, pas d'attente sur une session
       async. Avant ce correctif, TOUS les comptes utilisaient le même
       accountId figé (config.public.js), donc la même ligne primary-key
       dans seba_state : le 1er inscrit la possédait, et les policies RLS
       (auth.uid() = user_id) bloquaient silencieusement l'upsert de tous
       les suivants (ni écriture, ni lecture de leurs propres données). */
    _accountId() {
      const cfg = window.SEBA_CONFIG;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (/^sb-.*-auth-token$/.test(k)) {
            const tok = JSON.parse(localStorage.getItem(k));
            const jwt = tok && tok.access_token;
            if (jwt) {
              const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
              if (payload && payload.sub) return payload.sub;
            }
          }
        }
      } catch (e) {}
      return cfg.accountId || 'default';
    },
    _headers(extra) {
      const cfg = window.SEBA_CONFIG;
      return Object.assign({ apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + this._bearer() }, extra || {});
    },
    /* Sans jeton de session reel, _bearer() retombe sur la cle anonyme
       (voir ci-dessus) : RLS (auth.uid() = user_id) refusera de toute
       facon lecture/ecriture pour ce cas. Ne pas meme tenter l'appel
       reseau evite un aller-retour et un 401 systematique en console pour
       un mode demo/anonyme ou l'echec est garanti, pas accidentel. */
    _hasSession(cfg) {
      return this._bearer() !== cfg.supabaseAnonKey;
    },
    async pull() {
      const cfg = window.SEBA_CONFIG;
      if (!this._hasSession(cfg)) return null;
      try {
        const res = await fetch(cfg.supabaseUrl + '/rest/v1/seba_state?select=state&account=eq.' + encodeURIComponent(this._accountId()), {
          headers: this._headers(),
        });
        if (!res.ok) {
          console.warn('[seba-data] lecture distante en echec (HTTP ' + res.status + ') — le cache local fait foi.');
          return null;
        }
        const rows = await res.json();
        return rows.length ? rows[0].state : null;
      } catch (e) {
        console.warn('[seba-data] lecture distante impossible (reseau) — le cache local fait foi.', e.message);
        return null;
      }
    },
    /* Ne pousse plus le blob entier (voir en-tête de fichier, Palier 1) :
       la projection locale reste a jour immediatement, la synchronisation
       reelle passe desormais par pushOp()/syncWorker() ci-dessous, un
       patch a la fois. save() ne fait donc plus qu'ecrire le cache local
       -- identique a LocalAdapter, garde une methode nommee explicitement
       pour documenter pourquoi ce n'est plus un push reseau. */
    save(state) {
      LocalAdapter.save(state);
    },
  };

  const hasSupabase = !!(window.SEBA_CONFIG && window.SEBA_CONFIG.supabaseUrl && window.SEBA_CONFIG.supabaseAnonKey);
  const adapter = hasSupabase ? SupabaseAdapter : LocalAdapter;

  let state = null;
  const listeners = [];

  function loadState() {
    state = adapter.load() || EMPTY();
    if (!state.seq) state.seq = { devis: 118, facture: 93 };
    if (!state.seq.contrat) state.seq.contrat = 0;
    if (!state.custom_services) state.custom_services = [];
    if (!state.contrats) state.contrats = [];
    if (!state.messages) state.messages = [];
    if (!state.clientRequests) state.clientRequests = [];
    return state;
  }
  function persist() {
    adapter.save(state);
    listeners.forEach(fn => { try { fn(); } catch (e) {} });
  }
  function uid() { return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ═══════════════════════════════════════════════════════════════
     SEBA CLIENT MEMORY & MISSION INTELLIGENCE
     (feature/client-crm-advanced, 2026-07-24)

     Fonctions PURES (client, state, now) -> résultat, réutilisées telles
     quelles par client-fiche.html (patron), app/dashboard.html (Command
     Center) et espace-terrain.html (employé, briefing uniquement -- jamais
     la mémoire brute). Exposées via window.SebaClientIntelligence plus bas.
     Aucun état caché, aucun appel réseau ici : les données déjà chargées
     (state.messages/state.interventions/etc., pré-récupérées par
     l'appelant comme pour buildOwnerDashboardViewModel) sont la seule
     entrée. Écritures réelles : voir SebaDB.clients (et SebaDB.interventions)
     plus bas dans ce fichier, qui persistent via SebaDB.update() (même
     mécanisme que le reste de seba_state -- pushOp/sync, aucune
     architecture parallèle).
  ═══════════════════════════════════════════════════════════════ */
  const MEMORY_TYPES = ['preference', 'access', 'equipment', 'risk', 'quality', 'billing', 'relationship', 'instruction'];
  const MEMORY_VISIBILITY = ['owner_only', 'internal_team', 'assigned_employee'];
  const MEMORY_IMPORTANCE = ['normal', 'important', 'critical'];
  const MEMORY_SOURCE = ['manual', 'intervention_report', 'client_message', 'incident', 'system'];

  /* Rétrocompatible : un client créé avant ce chantier n'a ni
     operationalMemory ni servicePlans -- toujours appelée avant toute
     lecture/écriture de ces structures, jamais supposées présentes. */
  function normalizeClientOperationalMemory(client) {
    if (!client) return client;
    if (!client.operationalMemory || !Array.isArray(client.operationalMemory.entries)) {
      client.operationalMemory = { entries: [] };
    }
    if (!Array.isArray(client.servicePlans)) client.servicePlans = [];
    return client;
  }

  function fullName(c) { return c ? ((c.prenom || '') + ' ' + (c.nom || '')).trim() : ''; }

  /* ═══════════════════════════════════════════════════════════════
     INTERVENTION 360 (feature/intervention-360) — modèle canonique
     partagé patron/employé/client. Une seule structure (intervention.
     execution + intervention.statusHistory), jamais trois systèmes
     séparés. Fonctions PURES (aucun accès state/SebaDB/réseau) --
     réutilisées telles quelles par docs/intervention-fiche.html,
     docs/espace-terrain.html et docs/client-espace.html via
     window.SebaClientIntelligence (même namespace que la mémoire client,
     un seul point d'exposition pour tout le "cerveau" produit).
  ═══════════════════════════════════════════════════════════════ */
  const CHECKLIST_ITEM_DEFAULTS = { required: false, checked: false, checkedAt: null, checkedBy: null, note: '' };
  const PHOTO_TYPES = ['before', 'during', 'after', 'incident'];
  const CLIENT_APPROVAL_STATUSES = ['pending', 'approved', 'issue_reported'];
  const COMPLETION_STATUSES = ['not_started', 'in_progress', 'paused', 'submitted', 'owner_approved', 'reopened'];
  const STATUS_HISTORY_EVENTS = ['prepared', 'assigned', 'started', 'paused', 'resumed', 'checklist_updated', 'photo_added', 'incident_reported', 'completed', 'client_approved', 'client_issue_reported', 'owner_approved', 'reopened', 'invoice_created'];

  /* Rétrocompatible : une intervention créée avant ce chantier n'a ni
     execution ni statusHistory -- toujours appelée avant toute lecture/
     écriture de ces structures, jamais supposées présentes. N'écrase
     JAMAIS une structure déjà là (idempotente à l'appel). */
  function normalizeIntervention(intervention) {
    if (!intervention) return intervention;
    if (!intervention.execution || typeof intervention.execution !== 'object') {
      intervention.execution = {
        checklist: [],
        timing: { scheduledStart: intervention.time || null, scheduledEnd: null, actualStart: null, pausedAt: null, pausedDurationMinutes: 0, actualEnd: null },
        photos: [], materials: [], incidents: [],
        clientApproval: null,
        completionStatus: 'not_started',
        submittedAt: null, reviewedAt: null, reviewedBy: null,
      };
    }
    const ex = intervention.execution;
    if (!Array.isArray(ex.checklist)) ex.checklist = [];
    if (!ex.timing || typeof ex.timing !== 'object') ex.timing = { scheduledStart: intervention.time || null, scheduledEnd: null, actualStart: null, pausedAt: null, pausedDurationMinutes: 0, actualEnd: null };
    if (typeof ex.timing.pausedDurationMinutes !== 'number') ex.timing.pausedDurationMinutes = 0;
    if (!Array.isArray(ex.photos)) ex.photos = [];
    if (!Array.isArray(ex.materials)) ex.materials = [];
    if (!Array.isArray(ex.incidents)) ex.incidents = [];
    if (ex.clientApproval === undefined) ex.clientApproval = null;
    if (!ex.completionStatus) ex.completionStatus = 'not_started';
    if (!Array.isArray(intervention.statusHistory)) intervention.statusHistory = [];
    return intervention;
  }

  /* Ajoute un événement d'historique -- JAMAIS fabriqué rétroactivement
     (appelé uniquement au moment réel de l'action, jamais reconstruit après
     coup). id stable (uid()) pour dédupliquer côté UI si nécessaire. */
  function pushStatusHistory(intervention, event, actorRole, actorId, metadata) {
    normalizeIntervention(intervention);
    if (STATUS_HISTORY_EVENTS.indexOf(event) === -1) return;
    intervention.statusHistory.push({ id: uid(), event, actorRole, actorId: actorId || null, createdAt: new Date().toISOString(), metadata: metadata || null });
  }

  /* Règles de blocage de finalisation (section 3 du chantier) -- PURE,
     réutilisée à l'identique côté client (bouton "Terminer" désactivé) et
     côté serveur (la RPC complete_my_intervention refait exactement ce
     calcul, jamais une confiance aveugle au navigateur). */
  function computeInterventionCompletionBlockers(intervention) {
    normalizeIntervention(intervention);
    const blockers = [];
    const uncheckedRequired = intervention.execution.checklist.filter(c => c.required && !c.checked);
    if (uncheckedRequired.length) blockers.push({ type: 'checklist', message: uncheckedRequired.length + ' tâche(s) obligatoire(s) non cochée(s)', items: uncheckedRequired.map(c => c.label) });
    const hasBefore = intervention.execution.photos.some(p => p.type === 'before');
    const hasAfter = intervention.execution.photos.some(p => p.type === 'after');
    if (intervention.requirePhotoBefore && !hasBefore) blockers.push({ type: 'photo', message: 'Photo "avant" obligatoire manquante' });
    if (intervention.requirePhotoAfter && !hasAfter) blockers.push({ type: 'photo', message: 'Photo "après" obligatoire manquante' });
    return blockers;
  }

  /* ── Synthèse client automatique (section 2) ──────────────────────────
     Uniquement des faits directement dérivés des données réelles -- aucun
     score, aucune estimation qualitative inventée. */
  function buildClientOperationalSummary(client, state, now) {
    now = now || new Date();
    normalizeClientOperationalMemory(client);
    const clientId = client.id;
    const nowISO = localISO(now);
    const interventions = (state.interventions || []).filter(i => i.clientId === clientId);
    const devisList = (state.devis || []).filter(d => d.clientId === clientId);
    const facturesList = (state.factures || []).filter(f => f.clientId === clientId);
    const messages = (state.messages || []).filter(m => m.clientId === clientId);
    const mem = client.operationalMemory.entries.filter(e => !e.archivedAt);

    const futureInterventions = interventions.filter(i => i.date >= nowISO && !i.done)
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const pastInterventions = interventions.filter(i => i.done || i.date < nowISO)
      .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
    const prochaineIntervention = futureInterventions[0] || null;
    const derniereIntervention = pastInterventions[0] || null;

    // Fréquence réelle : intervalle moyen (jours) entre interventions
    // TERMINÉES réelles -- jamais une fréquence supposée/déclarative.
    const terminees = interventions.filter(i => i.done).sort((a, b) => a.date.localeCompare(b.date));
    let frequenceReelle = null;
    if (terminees.length >= 2) {
      const gaps = [];
      for (let k = 1; k < terminees.length; k++) {
        const d1 = new Date(terminees[k - 1].date + 'T12:00:00'), d2 = new Date(terminees[k].date + 'T12:00:00');
        gaps.push(Math.round((d2 - d1) / 864e5));
      }
      const avgDays = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
      const label = avgDays <= 9 ? 'hebdomadaire' : avgDays <= 16 ? 'toutes les deux semaines' : avgDays <= 35 ? 'mensuelle' : 'tous les ' + avgDays + ' jours en moyenne';
      frequenceReelle = { avgDays, label };
    }

    const facturesRetard = facturesList.filter(f => f.status === 'retard');
    const devisAttente = devisList.filter(d => d.status === 'attente');

    const incidentsRecents = interventions
      .filter(i => i.fieldReport && i.fieldReport.issueType && i.fieldReport.issueType !== 'none')
      .sort((a, b) => (b.fieldReport.completedAt || '').localeCompare(a.fieldReport.completedAt || ''))
      .slice(0, 3);

    const preferencesImportantes = mem.filter(e => e.type === 'preference' && (e.importance === 'important' || e.importance === 'critical'));
    const accesCritiques = mem.filter(e => e.type === 'access' && e.importance === 'critical');

    const derniereCommunication = messages.length
      ? messages.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0]
      : null;

    // Période d'inactivité : le plus récent entre dernière intervention
    // terminée et dernière communication -- "0 jour" si contact aujourd'hui.
    let dernierContactDate = derniereIntervention ? derniereIntervention.date : null;
    if (derniereCommunication && derniereCommunication.createdAt) {
      const commDate = String(derniereCommunication.createdAt).slice(0, 10);
      if (!dernierContactDate || commDate > dernierContactDate) dernierContactDate = commDate;
    }
    const periodeInactiviteJours = dernierContactDate
      ? Math.max(0, Math.floor((now - new Date(dernierContactDate + 'T12:00:00')) / 864e5))
      : null;

    // Prestation récurrente manquante : plan actif sans AUCUNE intervention
    // future qui en soit issue (recurrenceKey préfixé par l'id du plan).
    const prestationRecurrenteManquante = (client.servicePlans || []).filter(p => p.active).filter(p =>
      !futureInterventions.some(i => i.recurrenceKey && i.recurrenceKey.indexOf(p.id + ':') === 0)
    );

    const informationsObligatoiresManquantes = [];
    if (!client.contact) informationsObligatoiresManquantes.push('contact');
    if (!client.adresse) informationsObligatoiresManquantes.push('adresse');

    return {
      prochaineIntervention, derniereIntervention, frequenceReelle, facturesRetard, devisAttente,
      incidentsRecents, preferencesImportantes, accesCritiques, derniereCommunication,
      periodeInactiviteJours, prestationRecurrenteManquante, informationsObligatoiresManquantes,
    };
  }

  /* ── Next Best Actions (section 3) -- moteur déterministe, priorités
     fixes, aucune phrase générique (chaque raison cite un fait précis). ── */
  function buildClientNextBestActions(client, state, now) {
    now = now || new Date();
    normalizeClientOperationalMemory(client);
    const nowISO = localISO(now);
    const clientId = client.id;
    const interventions = (state.interventions || []).filter(i => i.clientId === clientId);
    const devisList = (state.devis || []).filter(d => d.clientId === clientId);
    const facturesList = (state.factures || []).filter(f => f.clientId === clientId);
    const actions = [];

    // 1. Facture échue -> relancer/ouvrir.
    facturesList.filter(f => f.status === 'retard').forEach(f => {
      actions.push({ id: 'facture_retard_' + f.id, priority: 'critical', reason: 'Facture ' + f.num + ' en retard de paiement', impact: 'Impact direct sur la trésorerie', actionLabel: 'Ouvrir la facture', actionUrl: 'factures.html?highlight=' + f.id, relatedResourceId: f.id });
    });

    // 2. Devis sans réponse depuis plusieurs jours -> relancer.
    devisList.filter(d => d.status === 'attente').forEach(d => {
      const days = Math.floor((now - new Date(d.date + 'T12:00:00')) / 864e5);
      if (days >= 7) actions.push({ id: 'devis_relance_' + d.id, priority: 'high', reason: 'Devis ' + d.num + ' sans réponse depuis ' + days + ' jours', impact: 'Risque de perte de l\'opportunité', actionLabel: 'Relancer le devis', actionUrl: 'devis.html?open=' + encodeURIComponent(d.num), relatedResourceId: d.id });
    });

    // 3. Prestation habituelle (plan actif) sans intervention future -> planifier.
    (client.servicePlans || []).filter(p => p.active).forEach(p => {
      const hasFuture = interventions.some(i => i.date >= nowISO && !i.done && i.recurrenceKey && i.recurrenceKey.indexOf(p.id + ':') === 0);
      if (!hasFuture) actions.push({ id: 'plan_a_generer_' + p.id, priority: 'medium', reason: 'Le plan "' + p.name + '" n\'a aucune intervention future générée', impact: 'Le client risque de ne pas être servi à temps', actionLabel: 'Générer les prochaines interventions', actionUrl: 'client-fiche.html?id=' + clientId, relatedResourceId: p.id });
    });

    // 4. Intervention future sans employé -> assigner.
    interventions.filter(i => i.date >= nowISO && !i.done && !i.employeId).forEach(i => {
      actions.push({ id: 'assign_' + i.id, priority: 'high', reason: 'Intervention du ' + i.date + ' sans employé assigné', impact: 'Mission à risque de ne pas être réalisée', actionLabel: 'Assigner un employé', actionUrl: 'assignation.html', relatedResourceId: i.id });
    });

    // 5. Incident non résolu -> ouvrir le signalement.
    interventions.filter(i => i.fieldReport && i.fieldReport.issueType && i.fieldReport.issueType !== 'none' && i.fieldReport.followUpRequired).forEach(i => {
      actions.push({ id: 'incident_' + i.id, priority: 'high', reason: 'Signalement "' + i.fieldReport.issueType + '" non résolu (intervention du ' + i.date + ')', impact: 'Suivi client requis', actionLabel: 'Voir le retour terrain', actionUrl: 'client-fiche.html?id=' + clientId, relatedResourceId: i.id });
    });

    // 6. Données d'accès manquantes avant une mission -> compléter.
    const prochaine = interventions.filter(i => i.date >= nowISO && !i.done).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))[0];
    if (prochaine) {
      const hasAccess = client.operationalMemory.entries.some(e => e.type === 'access' && !e.archivedAt);
      if (!hasAccess && !client.adresse) {
        actions.push({ id: 'acces_manquant_' + prochaine.id, priority: 'critical', reason: 'Aucune information d\'accès avant la mission du ' + prochaine.date, impact: 'L\'employé risque de ne pas pouvoir intervenir', actionLabel: 'Compléter les accès', actionUrl: 'client-fiche.html?id=' + clientId, relatedResourceId: prochaine.id });
      }
    }

    // 7. Client inactif depuis une période configurable -> reprendre contact.
    const INACTIVITY_THRESHOLD_DAYS = 60;
    const summary = buildClientOperationalSummary(client, state, now);
    if (summary.periodeInactiviteJours != null && summary.periodeInactiviteJours >= INACTIVITY_THRESHOLD_DAYS) {
      actions.push({ id: 'inactif_' + clientId, priority: 'medium', reason: 'Aucun contact depuis ' + summary.periodeInactiviteJours + ' jours', impact: 'Risque de perte du client', actionLabel: 'Reprendre contact', actionUrl: 'client-fiche.html?id=' + clientId, relatedResourceId: clientId });
    }

    // 8. Intervention terminée sans compte rendu -> demander le retour terrain.
    interventions.filter(i => i.done && i.employeId && !i.fieldReport).forEach(i => {
      actions.push({ id: 'fieldreport_manquant_' + i.id, priority: 'low', reason: 'Intervention du ' + i.date + ' terminée sans compte rendu', impact: 'Aucune trace du déroulement de la mission', actionLabel: 'Demander le retour terrain', actionUrl: 'client-fiche.html?id=' + clientId, relatedResourceId: i.id });
    });

    const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
    actions.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    return actions;
  }

  /* ── Plans de service récurrents (section 4) ──────────────────────────
     Ajoute `months` à une date en "clampant" au dernier jour du mois
     cible quand le jour d'origine n'existe pas dedans (31 janvier + 1 mois
     -> 28/29 février, jamais un débordement silencieux sur mars). Calculée
     via new Date(y, m+1, 0) (dernier jour du mois m, 0-indexé) -- gère
     nativement février/années bissextiles sans cas particulier. Construite
     à midi local (jamais minuit) pour ne jamais changer de jour lors d'un
     changement d'heure (DST) : setDate/setMonth restent des opérations en
     heure LOCALE dans le moteur JS Date, un midi ne bascule jamais de date
     même avec un décalage DST de ±1h. */
  function addMonthsClamped(date, months, dayOfMonth) {
    const targetMonthIndex = date.getMonth() + months;
    const y = date.getFullYear() + Math.floor(targetMonthIndex / 12);
    const m = ((targetMonthIndex % 12) + 12) % 12;
    const lastDayOfMonth = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(dayOfMonth, lastDayOfMonth), 12, 0, 0);
  }

  /* PURE : aucun accès à `state`/SebaDB/réseau, uniquement (plan, fromDate,
     horizonDays) -> dates ISO locales (jamais UTC -- localISO()) couvertes
     par le plan sur l'horizon demandé, à PARTIR de fromDate (jamais dans
     le passé -- "occurrence passée non générée"). testable isolément sans
     seeder de state. */
  function computeOccurrenceDates(plan, fromDate, horizonDays) {
    const dates = [];
    if (!plan.startDate) return dates;
    const from = new Date(fromDate); from.setHours(12, 0, 0, 0);
    const horizonEnd = new Date(from); horizonEnd.setDate(horizonEnd.getDate() + (horizonDays || 30));
    const planStart = new Date(plan.startDate + 'T12:00:00');
    const planEnd = plan.endDate ? new Date(plan.endDate + 'T12:00:00') : null;
    const startFloor = planStart > from ? planStart : from;

    if (plan.frequency === 'weekly' || plan.frequency === 'biweekly') {
      const stepDays = plan.frequency === 'weekly' ? 7 : 14;
      let d = new Date(planStart);
      while (d < startFloor) d.setDate(d.getDate() + stepDays);
      while (d <= horizonEnd) {
        if (!planEnd || d <= planEnd) dates.push(localISO(d));
        d.setDate(d.getDate() + stepDays);
      }
    } else if (plan.frequency === 'monthly') {
      const dayOfMonth = planStart.getDate();
      let d = new Date(planStart);
      let k = 0;
      while (d < startFloor) { k++; d = addMonthsClamped(planStart, k, dayOfMonth); }
      while (d <= horizonEnd) {
        if (!planEnd || d <= planEnd) dates.push(localISO(d));
        k++;
        d = addMonthsClamped(planStart, k, dayOfMonth);
      }
    } else if (plan.frequency === 'custom_weekdays') {
      const weekdays = plan.weekdays || [];
      let d = new Date(startFloor);
      let guard = 0;
      while (d <= horizonEnd && guard < 400) {
        if (weekdays.includes(d.getDay()) && d >= planStart && (!planEnd || d <= planEnd)) dates.push(localISO(d));
        d.setDate(d.getDate() + 1);
        guard++;
      }
    }
    return dates;
  }

  /* PURE : (plan, existingInterventions, fromDate, horizonDays) -> occurrences
     à créer / à ignorer -- AUCUN accès à `state`, SebaDB ou au réseau ici,
     contrairement à l'ancienne materializeServicePlanOccurrences() qui
     mélangeait calcul et écriture (corrigé -- voir persistServicePlanOccurrences
     ci-dessous pour la partie écriture). Idempotence garantie par construction :
     recurrenceKey = `${plan.id}:${date}:${heure}`, toCreate ne contient
     jamais une clé déjà présente dans existingInterventions. */
  function computeServicePlanOccurrences(plan, existingInterventions, fromDate, horizonDays) {
    const dates = computeOccurrenceDates(plan, fromDate, horizonDays || plan.horizonDays || 30);
    const existingKeys = new Set((existingInterventions || []).filter(i => i.recurrenceKey).map(i => i.recurrenceKey));
    const time = plan.preferredStartTime || '09:00';
    const toCreate = [], toSkip = [];
    dates.forEach(dateISO => {
      const key = plan.id + ':' + dateISO + ':' + time;
      if (existingKeys.has(key)) toSkip.push(key);
      else toCreate.push({ date: dateISO, time, recurrenceKey: key });
    });
    return { toCreate, toSkip };
  }

  /* IMPURE : seule fonction qui écrit réellement -- consomme le résultat de
     computeServicePlanOccurrences() (pure) et crée les interventions via
     SebaDB.create() (persistance + pushOp/sync, comme toute autre écriture
     du moteur). Reste idempotente à l'usage : relancer plusieurs fois de
     suite ne recrée jamais les occurrences déjà matérialisées, puisque
     toCreate exclut déjà toute recurrenceKey existante au moment du calcul. */
  function persistServicePlanOccurrences(client, plan, stateArg, horizonDays) {
    const st = stateArg || state;
    if (!st) return { created: 0, skipped: 0, occurrences: [] };
    const { toCreate, toSkip } = computeServicePlanOccurrences(plan, st.interventions || [], new Date(), horizonDays);
    const emp = plan.assignedEmployeeId ? (st.employes || []).find(e => e.id === plan.assignedEmployeeId) : null;
    const occurrences = toCreate.map(occ => SebaDB.create('interventions', {
      date: occ.date, time: occ.time, clientId: client.id, clientName: fullName(client),
      service: plan.service, employeId: plan.assignedEmployeeId || null,
      employeName: emp ? fullName(emp) : null, duree: plan.duration || null,
      done: false, recurrenceKey: occ.recurrenceKey, instructions: plan.instructions || null,
      servicePlanId: plan.id, adresse: client.adresse || null,
    }));
    return { created: occurrences.length, skipped: toSkip.length, occurrences };
  }

  /* ── Briefing automatique de mission (section 5) ──────────────────────
     Snapshot au moment de la génération -- exclut STRICTEMENT toute entrée
     owner_only et toute donnée financière (aucun montant/marge/solde n'est
     lu ici, par construction : client.ca/factures/devis ne sont jamais
     référencés dans cette fonction). */
  function generateMissionBrief(client, intervention, stateArg) {
    const st = stateArg || state;
    normalizeClientOperationalMemory(client);
    const mem = client.operationalMemory.entries.filter(e => !e.archivedAt && e.visibility !== 'owner_only');
    const pick = t => mem.filter(e => e.type === t).map(e => ({ id: e.id, title: e.title, content: e.content, importance: e.importance }));

    const accessInstructions = pick('access');
    const operationalInstructions = pick('instruction');
    if (intervention.instructions) operationalInstructions.push({ id: 'mission-instructions', title: 'Consignes de la mission', content: intervention.instructions, importance: 'normal' });
    const importantPreferences = pick('preference').filter(e => e.importance === 'important' || e.importance === 'critical');
    const risks = pick('risk');
    const equipment = pick('equipment');

    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
    const recentIncidents = (st.interventions || [])
      .filter(i => i.clientId === client.id && i.id !== intervention.id && i.fieldReport && i.fieldReport.issueType && i.fieldReport.issueType !== 'none')
      .filter(i => !i.fieldReport.completedAt || new Date(i.fieldReport.completedAt) >= cutoff)
      .sort((a, b) => (b.fieldReport.completedAt || '').localeCompare(a.fieldReport.completedAt || ''))
      .slice(0, 3)
      .map(i => ({ date: i.date, issueType: i.fieldReport.issueType, description: i.fieldReport.issueDescription || '' }));

    const pastInterventions = (st.interventions || []).filter(i => i.clientId === client.id && i.id !== intervention.id && i.done && i.fieldReport && i.fieldReport.summary)
      .sort((a, b) => b.date.localeCompare(a.date));
    const previousInterventionSummary = pastInterventions[0] ? { date: pastInterventions[0].date, summary: pastInterventions[0].fieldReport.summary } : null;

    return {
      generatedAt: new Date().toISOString(),
      clientName: fullName(client),
      contact: client.contact || null,
      address: client.adresse || intervention.adresse || null,
      accessInstructions, operationalInstructions, importantPreferences, risks, equipment,
      recentIncidents, previousInterventionSummary,
      billingWarning: false, // jamais de montant/marge/solde exposé à l'employé
    };
  }

  /* ── Enrichissement contrôlé de la mémoire (section 7) -- heuristique
     déterministe simple, JAMAIS une écriture automatique de la mémoire
     permanente : produit des SUGGESTIONS que le patron accepte/modifie/
     ignore explicitement (voir SebaDB.interventions.acceptMemorySuggestion).
     id stable (dérivé de l'id d'intervention + type) : une suggestion
     ignorée ne réapparaît jamais pour le même rapport. ── */
  function generateMemorySuggestions(fieldReport, intervention) {
    const suggestions = [];
    const base = 'sugg_' + intervention.id + '_';
    const ISSUE_TYPE_TO_MEMORY = { access: 'access', client_absent: 'relationship', equipment: 'equipment', damage: 'risk', quality: 'quality', delay: 'relationship', other: 'risk' };
    if (fieldReport.issueType && fieldReport.issueType !== 'none') {
      const memType = ISSUE_TYPE_TO_MEMORY[fieldReport.issueType] || 'risk';
      suggestions.push({
        id: base + 'issue', label: 'Incident récurrent : ' + fieldReport.issueType,
        entry: { type: memType, title: 'Incident signalé (' + fieldReport.issueType + ')', content: fieldReport.issueDescription || fieldReport.summary || '', visibility: 'internal_team', importance: 'important' },
      });
    }
    if (fieldReport.summary && fieldReport.summary.trim().length > 12 && fieldReport.outcome === 'completed') {
      suggestions.push({
        id: base + 'note', label: 'Observation terrain',
        entry: { type: 'quality', title: 'Retour de mission', content: fieldReport.summary.trim(), visibility: 'internal_team', importance: 'normal' },
      });
    }
    return suggestions;
  }

  /* ═══════════ File de patchs delta + worker de synchro (Palier 1) ═══════
     N'existe que si Supabase est configure (hasSupabase) : en mode local
     pur, pushOp() est un no-op immediat, aucune cle localStorage
     supplementaire n'est meme ecrite. */
  const PENDING_KEY = 'seba_pending_ops';
  const FAILED_KEY = 'seba_failed_ops'; // operations abandonnees apres MAX_OP_ATTEMPTS -- jamais supprimees, deplacees ici (visibles/recuperables via SebaDB.retrySyncNow())
  const DEVICE_KEY = 'seba_device_id';
  const SEQ_KEY = 'seba_client_seq';
  const MAX_OP_ATTEMPTS = 5;
  const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000]; // reessai apres echec (HTTP/reseau/operation) : delai progressif, plafonne a 60s, jamais de boucle serree
  let _syncFailureStreak = 0;
  function backoffDelay() {
    const idx = Math.min(Math.max(_syncFailureStreak - 1, 0), RETRY_DELAYS_MS.length - 1);
    return RETRY_DELAYS_MS[idx];
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) { id = 'dev_' + uid(); localStorage.setItem(DEVICE_KEY, id); }
      return id;
    } catch (e) { return 'dev_ephemeral'; } // pas de localStorage (mode prive strict) : identite non persistante, degrade sans planter
  }
  let _clientSeq = null;
  function nextClientSeq() {
    if (_clientSeq === null) {
      try { _clientSeq = parseInt(localStorage.getItem(SEQ_KEY) || '0', 10) || 0; }
      catch (e) { _clientSeq = 0; }
    }
    _clientSeq += 1;
    try { localStorage.setItem(SEQ_KEY, String(_clientSeq)); } catch (e) {}
    return _clientSeq;
  }
  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveQueue(queue) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(queue)); } catch (e) {}
  }
  function loadFailed() {
    try { return JSON.parse(localStorage.getItem(FAILED_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveFailed(list) {
    try { localStorage.setItem(FAILED_KEY, JSON.stringify(list)); } catch (e) {}
  }

  /* ═══ Indicateur visuel (file d'attente/echecs) + reessai manuel ═══
     Widget minimal auto-injecte par seba-data.js -- aucune page a modifier.
     Visible uniquement si une operation est en attente ou a echoue.
     Aucune couleur en dur : uniquement des tokens CSS deja definis par
     chaque page (theme.css pour les pages pro-global, Tactical Dark pour
     dashboard.html) -- voir tools/check-design-system.js.

     fix(sync-ui) 2026-07-24 : ce widget partageait EXACTEMENT le coin
     bas-droit du FAB IA (.ai-chat-fab, ai-assistant.js -- bottom:28/right:28,
     z-index:300) et, sur mobile, chevauchait la navigation inferieure des
     portails (.et-bottom-nav, espace-terrain.html -- position:fixed sur
     toute la largeur). Un widget position:fixed EST toujours dans le
     viewport, a tout defilement -- sur une page plus haute que l'ecran
     (le nouveau dashboard command-center en particulier), aucun decalage
     vertical ne peut a lui seul garantir zero chevauchement avec UNE carte
     de contenu normal, puisque le contenu defile SOUS un point fixe quel
     qu'il soit. La seule zone reellement et TOUJOURS vide de cartes, a
     n'importe quelle position de defilement, est le rail lateral
     (.sidebar, colonne dediee, aucune carte n'y vit jamais) en desktop, et
     la bande du mobile-header sticky (toujours au-dessus du flux) en
     mobile. Le widget est donc ancre dans CES zones plutot que flotter
     au hasard au-dessus du contenu :
       - desktop (sidebar visible) : coin bas de la colonne sidebar --
         aucune carte n'y vit jamais, a n'importe quelle position de
         defilement (contrairement a un point fixe flottant au-dessus du
         contenu, qui recouvre systematiquement CE QUI DEFILE dessous) ;
       - mobile (.mobile-header sticky present) : le widget devient un
         ENFANT du bandeau lui-meme (position:absolute dans ce conteneur
         sticky), jamais superpose au flux de contenu qui commence
         toujours EN DESSOUS du bandeau ;
       - repli (ni sidebar ni mobile-header trouves) : coin bas-droit
         classique avec degagement dynamique du FAB/de la nav inferieure.
     Aucun changement de la logique T3 (loadQueue/loadFailed/scheduleSyncWorker/
     retrySyncNow) ci-dessous : uniquement la presentation. */
  let _syncIndicatorEl = null;
  let _syncIndicatorStyleInjected = false;
  function ensureSyncIndicatorStyle() {
    if (_syncIndicatorStyleInjected || typeof document === 'undefined' || !document.head) return;
    const style = document.createElement('style');
    style.id = 'seba-sync-indicator-style';
    style.textContent =
      '#seba-sync-indicator{position:fixed;right:16px;left:auto;bottom:var(--seba-sync-bottom,16px);z-index:250;' +
      'display:none;align-items:center;gap:8px;padding:10px 14px;border-radius:var(--rs,8px);' +
      'background:var(--white);border:1px solid var(--border);color:var(--ink);font-size:.82rem;' +
      'box-shadow:var(--shadow-md,0 4px 16px rgba(0,0,0,.4));' +
      'max-width:min(320px,calc(100vw - 32px));max-height:120px;overflow-y:auto;box-sizing:border-box;}' +
      '#seba-sync-indicator .seba-sync-indicator-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '#seba-sync-indicator button{flex-shrink:0;}' +
      /* Desktop (sidebar visible, colonne 220px reelle sur les pages pro) :
         ancre dans le coin bas de CETTE colonne -- jamais une carte de
         contenu n'y vit, quel que soit le defilement. Largeur reduite pour
         tenir dans la colonne (texte tronque proprement, titre complet au
         survol). */
      '@media (min-width:769px){#seba-sync-indicator{left:16px;right:auto;max-width:190px;}}' +
      '@media (max-width:768px){#seba-sync-indicator{right:12px;max-width:calc(100vw - 24px);}}' +
      /* Ancrage dans .mobile-header (JS: placeSyncIndicator()) -- widget
         reparente comme enfant du bandeau sticky, jamais superpose au
         contenu qui commence toujours en dessous. Compact (place partagee
         avec logo + hamburger) : largeur, hauteur et police reduites. */
      '#seba-sync-indicator.seba-sync-in-header{position:absolute;top:50%;bottom:auto;left:auto;right:52px;' +
      'transform:translateY(-50%);max-width:min(150px,calc(100vw - 190px));max-height:none;padding:6px 8px;' +
      'gap:6px;font-size:.72rem;box-shadow:none;}' +
      '#seba-sync-indicator.seba-sync-in-header button{padding:3px 7px;font-size:.68rem;}';
    document.head.appendChild(style);
    _syncIndicatorStyleInjected = true;
  }
  /* Reparente le widget dans .mobile-header (bandeau sticky, jamais
     recouvert par le contenu qui defile) quand il est visible -- sinon le
     laisse en enfant de body avec le positionnement fixe (coin de sidebar
     en desktop, repli bas-droit sinon). Rappele a chaque updateSyncIndicator()
     et au redimensionnement : la bascule desktop/mobile peut survenir a
     tout moment (fenetre redimensionnee, rotation d'ecran). */
  function placeSyncIndicator(el) {
    if (!el) return;
    let header = null;
    try {
      const h = document.querySelector('.mobile-header');
      if (h && getComputedStyle(h).display !== 'none' && h.getBoundingClientRect().height > 0) header = h;
    } catch (e) {}
    if (header) {
      if (el.parentNode !== header) header.appendChild(el);
      el.classList.add('seba-sync-in-header');
    } else {
      if (el.parentNode !== document.body) document.body.appendChild(el);
      el.classList.remove('seba-sync-in-header');
    }
  }
  /* Decalage vertical necessaire pour degager le FAB IA et toute navigation
     inferieure pleine largeur en repli bas-droit (widget PAS ancre dans
     .mobile-header), et le pied de sidebar (.sidebar-footer, desktop) --
     obstacles reellement presents et visibles sur CETTE page a cet instant,
     jamais une valeur supposee a l'avance. Sans objet quand le widget est
     ancre dans .mobile-header (position:absolute dans ce conteneur, aucun
     decalage de viewport a calculer). */
  function computeSyncIndicatorBottom() {
    let clearance = 16;
    try {
      ['.ai-chat-fab', '.et-bottom-nav', '.mob-bottom-nav', '.bottom-nav', '.sidebar-footer'].forEach(sel => {
        const el = document.querySelector(sel);
        if (!el || getComputedStyle(el).display === 'none') return;
        const rect = el.getBoundingClientRect();
        // Ignore un element hors-champ (largeur/hauteur nulle, ou entierement
        // au-dessus/en-dessous du viewport -- ex. sidebar-footer d'un menu
        // mobile ferme, translate() hors ecran mais display toujours "flex").
        if (rect.height <= 0 || rect.width <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return;
        const fromBottom = Math.round(window.innerHeight - rect.top) + 12;
        if (fromBottom > clearance) clearance = fromBottom;
      });
    } catch (e) {}
    return clearance;
  }
  function ensureSyncIndicatorEl() {
    ensureSyncIndicatorStyle();
    if (_syncIndicatorEl || typeof document === 'undefined' || !document.body) return _syncIndicatorEl;
    const el = document.createElement('div');
    el.id = 'seba-sync-indicator';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite'); // role="status" l'implique deja, explicite ici pour la compatibilite des lecteurs d'ecran les moins recents
    const label = document.createElement('span');
    label.className = 'seba-sync-indicator-label';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Réessayer';
    btn.style.cssText = 'background:var(--emerald);color:var(--on-emerald,#031A12);border:none;border-radius:var(--rs,8px);padding:4px 10px;font-size:.78rem;font-weight:600;cursor:pointer;';
    btn.addEventListener('click', retrySyncNow);
    el.appendChild(label);
    el.appendChild(btn);
    document.body.appendChild(el);
    _syncIndicatorEl = el;
    if (typeof window !== 'undefined') {
      const recompute = () => {
        if (!_syncIndicatorEl || _syncIndicatorEl.style.display === 'none') return;
        placeSyncIndicator(_syncIndicatorEl);
        if (_syncIndicatorEl.classList.contains('seba-sync-in-header')) {
          // Ancre dans le bandeau sticky : position:absolute dans ce
          // conteneur, aucun degagement de viewport ni reservation de
          // page a calculer (le bandeau n'est jamais recouvert par le
          // contenu, qui commence toujours en dessous de lui).
          releaseBottomSpace();
          return;
        }
        const bottomOffset = computeSyncIndicatorBottom();
        _syncIndicatorEl.style.setProperty('--seba-sync-bottom', bottomOffset + 'px');
        reserveBottomSpace(bottomOffset + _syncIndicatorEl.offsetHeight + 16);
      };
      window.addEventListener('resize', recompute);
      // Le FAB IA (ai-assistant.js) et les navigations inferieures des
      // portails sont charges en <script defer> : pas encore montes au
      // moment ou ce widget s'auto-injecte (seba-data.js n'est pas differe).
      // 'load' (apres TOUS les scripts differes) + un court delai de secours
      // couvrent un montage encore plus tardif (composant qui s'auto-monte
      // apres son propre fetch/init asynchrone).
      window.addEventListener('load', recompute);
      setTimeout(recompute, 800);
    }
    return el;
  }
  /* Un widget position:fixed peut toujours degager UN obstacle connu (FAB,
     nav) mais pas le contenu de page lui-meme, qui remplit toute la hauteur
     du document -- sans reserver l'equivalent en padding-bottom, la derniere
     carte d'une page (ex. "Paiements a surveiller" du dashboard) finit
     TOUJOURS sous ce widget des que la page est assez longue. Reserve donc
     un espace reel en bas du document, degage seulement quand le widget est
     cache -- jamais applique en permanence (aucune page n'a de padding en
     trop tant qu'aucune synchro n'est en attente/en echec). */
  let _origBodyPaddingBottom = null;
  function reserveBottomSpace(px) {
    if (typeof document === 'undefined' || !document.body) return;
    if (_origBodyPaddingBottom === null) _origBodyPaddingBottom = document.body.style.paddingBottom || '';
    document.body.style.paddingBottom = 'calc(' + (_origBodyPaddingBottom || '0px') + ' + ' + px + 'px)';
  }
  function releaseBottomSpace() {
    if (typeof document === 'undefined' || !document.body || _origBodyPaddingBottom === null) return;
    document.body.style.paddingBottom = _origBodyPaddingBottom;
  }
  function updateSyncIndicator() {
    if (typeof document === 'undefined') return;
    const render = () => {
      const el = ensureSyncIndicatorEl();
      if (!el) return;
      const pending = loadQueue().length;
      const failed = loadFailed().length;
      if (pending === 0 && failed === 0) { el.style.display = 'none'; releaseBottomSpace(); return; }
      placeSyncIndicator(el);
      el.style.display = 'flex';
      const parts = [];
      if (pending > 0) parts.push(pending === 1 ? '1 modification en attente' : pending + ' modifications en attente');
      if (failed > 0) parts.push(failed === 1 ? '1 echec definitif' : failed + ' echecs definitifs');
      const label = el.querySelector('.seba-sync-indicator-label');
      label.textContent = parts.join(' · ');
      label.title = parts.join(' · '); // texte complet au survol si tronque par l'ellipsis CSS
      if (el.classList.contains('seba-sync-in-header')) {
        // Ancre dans le bandeau sticky : jamais recouvert par le contenu,
        // aucune reservation de page necessaire.
        releaseBottomSpace();
      } else {
        const bottomOffset = computeSyncIndicatorBottom();
        el.style.setProperty('--seba-sync-bottom', bottomOffset + 'px');
        // Mesure APRES affichage (display:flex) pour avoir une hauteur reelle.
        reserveBottomSpace(bottomOffset + el.offsetHeight + 16);
      }
    };
    if (document.body) render();
    else document.addEventListener('DOMContentLoaded', render, { once: true });
  }

  /* Reessai manuel (bouton de l'indicateur ou SebaDB.retrySyncNow()) :
     replace les operations echouees definitivement dans la file active
     (compteur d'essais remis a zero) et relance le worker immediatement. */
  function retrySyncNow() {
    const failed = loadFailed();
    if (failed.length) {
      const queue = loadQueue().concat(failed.map(o => Object.assign({}, o, { attempts: 0 })));
      saveQueue(queue);
      saveFailed([]);
    }
    _syncFailureStreak = 0;
    scheduleSyncWorker(0);
    updateSyncIndicator();
  }

  /* Met en file un patch delta pour une entite -- jamais l'objet seba_state
     entier (Pilier 1). `patch` = uniquement les champs concernes : l'objet
     complet pour un 'create' (entity_versions n'a rien a fusionner dessus),
     les champs modifies pour un 'update', un marqueur de suppression
     douce pour un 'delete' (apply_entity_patch ne fait qu'un merge JSONB,
     il n'existe pas de suppression physique cote serveur aujourd'hui --
     voir remove() plus bas). */
  function pushOp(entity, entityId, op, patch) {
    if (!hasSupabase) return;
    const queue = loadQueue();
    queue.push({ client_seq: nextClientSeq(), entity, entity_id: entityId, op, patch, attempts: 0 });
    saveQueue(queue);
    scheduleSyncWorker();
    updateSyncIndicator();
  }

  let _syncTimer = null;
  let _syncing = false;
  function scheduleSyncWorker(delay) {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(syncWorker, typeof delay === 'number' ? delay : 800); // 800ms = meme debounce que l'ancien push blob (ecriture normale) ; delay explicite = reessai (flush au chargement, backoff, evenement online)
  }

  /* Vide seba_pending_ops vers sync-push.ts par lots. Idempotent cote
     serveur (unique(account, device_id, client_seq)) : rejouer le meme
     lot apres une coupure ne duplique jamais rien, donc aucune precaution
     particuliere n'est necessaire ici en cas de double declenchement.
     Echec (HTTP hors 2xx/207, ou reseau) : re-essai automatique avec
     delai progressif (backoffDelay()), jamais silencieux -- la file reste
     intacte et l'indicateur visuel reste affiche. */
  async function syncWorker() {
    if (_syncing) { scheduleSyncWorker(500); return; } // deja un run en cours : on repousse au lieu de perdre silencieusement ce declenchement
    const cfg = window.SEBA_CONFIG;
    if (!hasSupabase || !SupabaseAdapter._hasSession(cfg)) return; // mode demo/anonyme : rien a synchroniser
    const queue = loadQueue();
    if (!queue.length) return;

    _syncing = true;
    try {
      // LEGACY (modele PIN retire 2026-07-19) -- seba_employee_token n'est
      // plus jamais ecrit nulle part (employeePortal ne pose plus de token
      // separe, l'employe a desormais sa PROPRE session Supabase comme
      // tout le monde) : ce bloc reste inoffensif (employeeToken vaut
      // toujours null) mais aucune page employe n'ecrit de donnees via
      // SebaDB.create/update aujourd'hui de toute facon (lecture + RPC
      // dediees + messagerie REST directe uniquement -- voir
      // employeePortal plus bas). A revoir si un futur besoin d'ecriture
      // cote employe apparait : sync-push.ts devrait alors accepter le
      // propre JWT de l'employe et le resoudre via employe_accounts.
      const employeeToken = (() => { try { return localStorage.getItem('seba_employee_token'); } catch (e) { return null; } })();
      const headers = Object.assign(
        { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey },
        SupabaseAdapter._headers(),
      );
      if (employeeToken) headers['X-Employee-Token'] = employeeToken;

      const res = await fetch(cfg.supabaseUrl + '/functions/v1/sync-push', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          device_id: getDeviceId(),
          operations: queue.map(o => ({ client_seq: o.client_seq, entity: o.entity, entity_id: o.entity_id, op: o.op, patch: o.patch })),
        }),
      });

      if (!res.ok && res.status !== 207) {
        console.warn('[seba-data] sync-push en echec (HTTP ' + res.status + ') — la file reste intacte, re-essai automatique programme.');
        _syncFailureStreak++;
        scheduleSyncWorker(backoffDelay());
        updateSyncIndicator();
        return;
      }
      const body = await res.json();
      const results = (body && body.results) || [];
      const acked = new Set(results.filter(r => r.status === 'applied' || r.status === 'ack_duplicate').map(r => r.client_seq));
      const errored = new Set(results.filter(r => r.status === 'error').map(r => r.client_seq));

      const candidates = queue
        .filter(o => !acked.has(o.client_seq))
        .map(o => errored.has(o.client_seq) ? Object.assign({}, o, { attempts: o.attempts + 1 }) : o);
      const remaining = [];
      const newlyFailed = [];
      candidates.forEach(o => {
        if (o.attempts > MAX_OP_ATTEMPTS) newlyFailed.push(o);
        else remaining.push(o);
      });
      if (newlyFailed.length) {
        saveFailed(loadFailed().concat(newlyFailed));
        console.error('[seba-data] ' + newlyFailed.length + ' operation(s) deplacee(s) vers seba_failed_ops apres ' + MAX_OP_ATTEMPTS + ' echecs -- jamais supprimees, toujours visibles/recuperables (indicateur + SebaDB.retrySyncNow()).', newlyFailed);
      }
      saveQueue(remaining);
      if (remaining.length) {
        _syncFailureStreak++;
        scheduleSyncWorker(backoffDelay()); // erreurs par operation (ex: 207 partiel) : meme politique de re-essai que l'echec HTTP global, pas de boucle serree
      } else {
        _syncFailureStreak = 0; // lot entierement acquitte : on repart a zero pour le prochain echec eventuel
      }
      updateSyncIndicator();
    } catch (e) {
      console.warn('[seba-data] sync-push impossible (reseau) — la file reste intacte, re-essai automatique programme.', e.message);
      _syncFailureStreak++;
      scheduleSyncWorker(backoffDelay());
      updateSyncIndicator();
    } finally {
      _syncing = false;
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { if (hasSupabase) { _syncFailureStreak = 0; scheduleSyncWorker(0); } }); // reconnexion detectee : on retente immediatement, sans heriter du backoff precedent
  }

  /* Date ISO en HEURE LOCALE — jamais toISOString() qui bascule au jour
     précédent en UTC pour les dates à minuit local (UTC+2 → -2h). */
  function localISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function todayISO(offsetDays) {
    const d = new Date(); d.setDate(d.getDate() + (offsetDays || 0));
    return localISO(d);
  }

  /* ═══════════ SEED — jeu de données de départ par secteur ═══════════
     Généré à la première visite après l'onboarding : dates relatives à
     aujourd'hui pour que planning/dashboard soient toujours vivants. */
  const SEED_NAMES = [
    ['Sophie', 'Lacroix', 's.lacroix@email.fr'], ['Marc', 'Roussel', '06 12 34 56 78'],
    ['Julie', 'Dumont', 'j.dumont@email.fr'], ['Pierre', 'Tessier', 'p.tessier@email.fr'],
    ['Camille', 'Faure', 'c.faure@email.fr'], ['Thomas', 'Berger', '06 98 76 54 32'],
  ];
  const SEED_SERVICES = {
    menage: ['Ménage standard', 'Grand ménage', 'Repassage', 'Nettoyage de vitres', 'Nettoyage fin de bail'],
    conciergerie: ['Check-in voyageurs', 'Ménage entre séjours', 'Gestion du linge', 'Remise des clés', 'État des lieux'],
    conciergerieCopro: ['Entretien parties communes', 'Gestion des colis', 'Sortie des poubelles', 'Petite maintenance', 'Rondes de contrôle'],
    conciergerieEntreprise: ['Accueil visiteurs', 'Gestion courrier', 'Réservations', 'Services aux salariés', 'Événementiel'],
    jardinage: ['Tonte de pelouse', 'Taille de haies', 'Désherbage', 'Entretien massifs', 'Élagage léger'],
    maintenance: ['Dépannage plomberie', 'Électricité', 'Montage meubles', 'Peinture', 'Petites réparations'],
    pressing: ['Nettoyage à sec', 'Repassage au kilo', 'Collecte à domicile', 'Livraison', 'Détachage'],
    beaute: ['Coupe & coiffage', 'Couleur', 'Soin visage', 'Manucure', 'Maquillage événement'],
    animaux: ['Promenade', 'Garde à domicile', 'Visite quotidienne', 'Toilettage', 'Pension'],
    demenagement: ['Déménagement complet', 'Transport meubles', 'Emballage', 'Monte-meubles', 'Garde-meubles'],
    autre: ['Prestation standard', 'Prestation premium', 'Déplacement', 'Conseil', 'Intervention urgente'],
  };
  const SEED_EMPLOYES = {
    menage: [['Léa', 'Martin', 'Agent de ménage'], ['Karim', 'Benali', 'Agent polyvalent'], ['Nora', 'Rahmani', 'Agente de ménage']],
    conciergerie: [['Léa', 'Martin', 'Agent conciergerie'], ['Marc', 'Tissot', 'Prestataire ménage']],
    jardinage: [['Lucas', 'Bernard', 'Paysagiste'], ['Antoine', 'Roux', 'Paysagiste']],
    maintenance: [['Thomas', 'Chevalier', 'Technicien'], ['Julien', 'Blanc', 'Technicien']],
    demenagement: [['Lucas', 'Bernard', 'Chauffeur-déménageur'], ['Antoine', 'Roux', 'Déménageur'], ['Julien', 'Blanc', 'Déménageur']],
    autre: [['Léa', 'Martin', 'Collaborateur']],
  };

  function seed(biz) {
    const secteur = (biz && biz.secteur) || 'autre';
    const services = SEED_SERVICES[secteur] || SEED_SERVICES.autre;
    const emps = SEED_EMPLOYES[secteur] || SEED_EMPLOYES.autre;
    const svc = i => services[i % services.length];

    // Clients
    const clients = SEED_NAMES.map((n, i) => ({
      id: uid(), prenom: n[0], nom: n[1], contact: n[2], adresse: '', notes: '',
      statut: i === 1 || i === 5 ? 'attente' : (i === 2 ? 'relance' : 'actif'),
      service: svc(i), ca: [570, 0, 160, 475, 60, 0][i], createdAt: todayISO(-30 + i * 4),
    }));
    const cname = i => clients[i].prenom + ' ' + clients[i].nom;

    // Devis (numérotation suit seq)
    let dSeq = state.seq.devis;
    const mkDevis = (ci, amount, status, dOff, lines) => ({
      id: uid(), num: '#' + String(++dSeq).padStart(4, '0'), clientId: clients[ci].id, clientName: cname(ci),
      service: lines[0].desc, lines, amount, status, date: todayISO(dOff),
      history: [{ label: status === 'signe' ? 'Devis signé' : (status === 'expire' ? 'Expiré' : 'Devis envoyé'), date: todayISO(dOff), cls: status === 'signe' ? 'g' : (status === 'expire' ? 'gr' : 'o') }],
    });
    const devis = [
      mkDevis(2, 40, 'expire', -22, [{ desc: svc(2), qty: 1, u: 40 }]),
      mkDevis(3, 95, 'signe', -14, [{ desc: svc(0), qty: 1, u: 65 }, { desc: svc(2), qty: 1, u: 30 }]),
      mkDevis(4, 60, 'attente', -10, [{ desc: svc(3), qty: 1, u: 60 }]),
      mkDevis(0, 95, 'signe', -8, [{ desc: svc(0), qty: 1, u: 65 }, { desc: svc(2), qty: 1, u: 30 }]),
      mkDevis(1, 180, 'attente', -5, [{ desc: svc(4), qty: 1, u: 180 }]),
      mkDevis(5, 85, 'attente', -3, [{ desc: svc(0), qty: 1, u: 55 }, { desc: svc(1), qty: 1, u: 30 }]),
    ];
    state.seq.devis = dSeq;

    // Factures
    let fSeq = state.seq.facture;
    const mkFact = (ci, amount, status, dOff, service) => ({
      id: uid(), num: '#F-' + String(++fSeq).padStart(4, '0'), clientId: clients[ci].id, clientName: cname(ci),
      service, amount, status, date: todayISO(dOff), paidAt: status === 'payee' ? todayISO(dOff + 2) : null,
    });
    const factures = [
      mkFact(4, 60, 'payee', -20, svc(3)),
      mkFact(1, 90, 'attente', -12, svc(4) + ' (acompte)'),
      mkFact(2, 40, 'retard', -16, svc(2)),
      mkFact(3, 95, 'payee', -9, svc(0) + ' — mensuel'),
      mkFact(0, 95, 'payee', -4, svc(0) + ' — mensuel'),
    ];
    state.seq.facture = fSeq;

    // Interventions — réparties sur la semaine courante (lundi → dimanche)
    const now = new Date();
    const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0);
    const dayISO = i => { const d = new Date(monday); d.setDate(monday.getDate() + i); return localISO(d); };
    const interventions = [
      { day: 0, time: '09:00', ci: 0, s: svc(0), done: true }, { day: 0, time: '14:00', ci: 3, s: svc(0), done: true },
      { day: 1, time: '10:30', ci: 2, s: svc(2), done: true },
      { day: 3, time: '11:00', ci: 1, s: svc(4), done: false },
      { day: 4, time: '09:00', ci: 0, s: svc(0), done: false },
      { day: 5, time: '09:00', ci: 0, s: svc(0) + ' — 2h', done: false },
      { day: 5, time: '13:30', ci: 3, s: svc(0) + ' — 1h30', done: false },
      { day: 5, time: '16:00', ci: 1, s: svc(4) + ' — 3h', done: false },
    ].map(j => ({
      id: uid(), date: dayISO(j.day), time: j.time, clientId: clients[j.ci].id,
      clientName: cname(j.ci), service: j.s, done: j.done,
    }));

    // Employés
    const employes = emps.map((e, i) => ({
      id: uid(), prenom: e[0], nom: e[1], role: e[2], actif: i < 2, missions: [5, 4, 3][i] || 2,
      acces: i === 2 ? 'planning seulement' : 'planning + clients',
    }));

    // Journal de départ
    const journal = [
      { id: uid(), ts: Date.now() - 3600e3 * 2, type: 'client', label: 'Nouveau client — ' + cname(5), href: 'clients.html' },
      { id: uid(), ts: Date.now() - 3600e3 * 5, type: 'paiement', label: 'Paiement reçu — ' + cname(0) + ' · 95 €', href: 'factures.html' },
      { id: uid(), ts: Date.now() - 3600e3 * 26, type: 'devis', label: 'Devis signé — ' + cname(3) + ' · 95 €', href: 'devis.html' },
      { id: uid(), ts: Date.now() - 3600e3 * 30, type: 'intervention', label: 'Intervention terminée — ' + cname(0), href: 'planning.html' },
    ];

    Object.assign(state, { clients, devis, factures, interventions, employes, journal });
    persist();
    // Un patch 'create' par entite generee -- meme granularite que create(),
    // pour que le premier compte reel (si Supabase est deja configure a cet
    // instant) ne diverge jamais du seed local des la premiere synchro.
    clients.forEach(c => pushOp('clients', c.id, 'create', c));
    devis.forEach(d => pushOp('devis', d.id, 'create', d));
    factures.forEach(f => pushOp('factures', f.id, 'create', f));
    interventions.forEach(i => pushOp('interventions', i.id, 'create', i));
    employes.forEach(e => pushOp('employes', e.id, 'create', e));
    journal.forEach(j => pushOp('journal', j.id, 'create', j));
  }

  /* ═══════════ API publique ═══════════ */
  const SebaDB = {
    adapterName: adapter.name,

    ready() {
      loadState();
      let biz = null;
      try { biz = JSON.parse(localStorage.getItem('sebaEntreprise')); } catch (e) {}
      if (biz && biz.secteur && !state.clients.length && !state._seeded) {
        state._seeded = true;
        seed(biz);
      }
      // Supabase : rapatrier l'état cloud en arrière-plan s'il est plus récent
      if (hasSupabase) {
        SupabaseAdapter.pull().then(cloud => {
          if (cloud && JSON.stringify(cloud) !== JSON.stringify(state)) {
            state = cloud; LocalAdapter.save(state);
            listeners.forEach(fn => { try { fn(); } catch (e) {} });
          }
        });
        // File non vide venant d'une session precedente (coupure, onglet
        // ferme avant reconnexion...) : on relance le worker au chargement,
        // sans attendre la prochaine ecriture ou le prochain evenement online.
        if (loadQueue().length) scheduleSyncWorker(0);
        updateSyncIndicator();
      }
      return state;
    },

    /* Reessai manuel (bouton "Réessayer" de l'indicateur, ou appel direct
       depuis une page qui voudrait son propre bouton). */
    retrySyncNow() { retrySyncNow(); },
    syncStatus() { return { pending: loadQueue().length, failed: loadFailed().length, syncing: _syncing }; },

    hasData() { if (!state) loadState(); return state.clients.length > 0; },

    list(coll) { if (!state) loadState(); return (state[coll] || []).slice(); },
    get(coll, id) { if (!state) loadState(); return (state[coll] || []).find(x => x.id === id) || null; },

    /* Briefing automatique de mission (SEBA CLIENT MEMORY & MISSION
       INTELLIGENCE, section 5) : hooké ICI au niveau du moteur plutôt que
       dans chaque page appelante (planning.html/assignation.html/
       dashboard.html) -- toute intervention créée avec un clientId, ou
       assignée pour la première fois (employeId qui passe de vide à
       renseigné), reçoit automatiquement son snapshot missionBrief. Snapshot
       FIGÉ au moment de la génération (jamais recalculé après coup par une
       simple lecture) : une modification ultérieure de la mémoire client ne
       change jamais silencieusement une mission déjà préparée -- seule une
       régénération EXPLICITE (SebaDB.interventions.regenerateMissionBrief())
       le fait. */
    create(coll, obj) {
      if (!state) loadState();
      const item = Object.assign({ id: uid(), createdAt: todayISO(0) }, obj);
      if (coll === 'interventions' && item.clientId) {
        const client = state.clients.find(c => c.id === item.clientId);
        if (client) { normalizeClientOperationalMemory(client); item.missionBrief = generateMissionBrief(client, item, state); }
      }
      state[coll].unshift(item);
      persist();
      pushOp(coll, item.id, 'create', item); // patch = objet complet, rien a fusionner cote serveur pour une creation
      return item;
    },
    update(coll, id, patch) {
      if (!state) loadState();
      const item = (state[coll] || []).find(x => x.id === id);
      if (item) {
        const wasUnassigned = coll === 'interventions' && !item.employeId;
        Object.assign(item, patch);
        if (coll === 'interventions' && wasUnassigned && item.employeId && item.clientId) {
          const client = state.clients.find(c => c.id === item.clientId);
          if (client) {
            normalizeClientOperationalMemory(client);
            const brief = generateMissionBrief(client, item, state);
            item.missionBrief = brief;
            patch = Object.assign({}, patch, { missionBrief: brief }); // le delta pousse aussi le brief, jamais désynchronisé de la version locale
          }
        }
        persist();
        pushOp(coll, id, 'update', patch); // patch = uniquement les champs modifies, jamais l'objet entier (Pilier 1)
      }
      return item;
    },
    remove(coll, id) {
      if (!state) loadState();
      const existed = (state[coll] || []).some(x => x.id === id);
      state[coll] = (state[coll] || []).filter(x => x.id !== id);
      persist();
      // apply_entity_patch() ne fait qu'un merge JSONB (voir supabase-schema.sql,
      // section 11) : il n'existe pas de suppression physique cote serveur
      // aujourd'hui. On pousse un marqueur de suppression douce -- la
      // projection LOCALE reste un retrait reel (list()/get() ne renvoient
      // plus l'element), seule la trace serveur garde _deleted pour l'audit.
      if (existed) pushOp(coll, id, 'delete', { _deleted: true, deletedAt: todayISO(0) });
    },

    nextNum(kind) {
      if (!state) loadState();
      if (kind === 'facture') return '#F-' + String(++state.seq.facture).padStart(4, '0');
      if (kind === 'contrat') return '#C-' + String(++state.seq.contrat).padStart(4, '0');
      return '#' + String(++state.seq.devis).padStart(4, '0');
    },

    log(type, label, href) {
      if (!state) loadState();
      const entry = { id: uid(), ts: Date.now(), type, label, href: href || '#' };
      state.journal.unshift(entry);
      if (state.journal.length > 200) state.journal.length = 200;
      persist();
      pushOp('journal', entry.id, 'create', entry);
    },
    journal(limit) { if (!state) loadState(); return state.journal.slice(0, limit || 50); },

    /* ── Messagerie (seba_messages, table Supabase dediee -- PAS le
       mecanisme generique state[coll]/entity_versions utilise par
       contrats/custom_services). Seule collection SebaDB qui parle
       directement a une vraie table : un fil de messages a besoin d'un
       tri/index par date et d'ecritures independantes, pas d'un blob
       JSONB unique a reecrire en entier a chaque message.
       API asynchrone (contrairement au reste de SebaDB, synchrone) : ces
       deux methodes peuvent faire un aller-retour reseau reel. Repli
       local automatique (state.messages, deja dans EMPTY()) des que
       Supabase n'est pas configure ou qu'aucune session n'existe --
       fonctionne donc identiquement en mode demo/file://.
       RLS (voir supabase-schema.sql section 32, reecrite pour l'Espace
       Client) : patron proprietaire du compte OU client lie a ce
       client_id via client_accounts. adapter._accountId() ne donne le
       BON account que pour le patron (extrait de SON JWT) -- un client
       authentifie a son PROPRE auth.uid(), qui n'est PAS l'account.
       filter.account/obj.account (fournis par l'appelant via
       clientPortal.profile().account) prevalent donc sur
       adapter._accountId() des qu'ils sont presents. employeId/clientId
       restent des champs descriptifs, jamais une frontiere de securite
       (RLS fait tout le travail cote serveur). ── */
    messages: {
      async list(filter) {
        if (!state) loadState();
        if (hasSupabase && adapter._hasSession(window.SEBA_CONFIG)) {
          try {
            const cfg = window.SEBA_CONFIG;
            const account = (filter && filter.account) || adapter._accountId();
            let url = cfg.supabaseUrl + '/rest/v1/seba_messages?account=eq.' + encodeURIComponent(account) + '&order=created_at.asc';
            if (filter && filter.clientId) url += '&client_id=eq.' + encodeURIComponent(filter.clientId);
            if (filter && filter.employeId) url += '&employe_id=eq.' + encodeURIComponent(filter.employeId);
            // Chat de mission (2026-07-20) : ancre sur UNE demande
            // (client_requests), independamment de client_id/employe_id --
            // voir migrations/20260720_mission_chat.sql pour le pourquoi.
            if (filter && filter.requestId) url += '&request_id=eq.' + encodeURIComponent(filter.requestId);
            const res = await fetch(url, { headers: adapter._headers() });
            // Normalise snake_case (colonnes Postgres) -> camelCase (convention
            // JS du reste de SebaDB) : sans ca, un appelant lisant m.clientId
            // trouverait undefined sur les messages venus de Supabase alors que
            // ca marcherait sur ceux du repli local (meme bug de forme que
            // mutation_docs vs SebaDB trouve en Phase 0 de ce chantier).
            if (res.ok) {
              const rows = await res.json();
              return rows.map(r => ({
                id: r.id, createdAt: r.created_at, clientId: r.client_id, employeId: r.employe_id,
                requestId: r.request_id,
                expediteurRole: r.expediteur_role, destinataireRole: r.destinataire_role,
                texte: r.texte, lu: r.lu,
              }));
            }
            console.warn('[seba-data] lecture messages distante en echec (HTTP ' + res.status + ') — repli local.');
          } catch (e) {
            console.warn('[seba-data] lecture messages distante impossible (reseau) — repli local.', e.message);
          }
        }
        return state.messages.filter(m =>
          (!filter || !filter.clientId || m.clientId === filter.clientId) &&
          (!filter || !filter.employeId || m.employeId === filter.employeId) &&
          (!filter || !filter.requestId || m.requestId === filter.requestId)
        );
      },
      async send(obj) {
        if (!state) loadState();
        if (hasSupabase && adapter._hasSession(window.SEBA_CONFIG)) {
          try {
            const cfg = window.SEBA_CONFIG;
            const body = {
              account: obj.account || adapter._accountId(),
              client_id: obj.clientId || null,
              employe_id: obj.employeId || null,
              request_id: obj.requestId || null,
              expediteur_role: obj.expediteurRole,
              destinataire_role: obj.destinataireRole,
              texte: obj.texte,
            };
            const res = await fetch(cfg.supabaseUrl + '/rest/v1/seba_messages', {
              method: 'POST',
              headers: adapter._headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
              body: JSON.stringify(body),
            });
            if (res.ok) {
              const rows = await res.json();
              const r = rows[0];
              // Meme normalisation snake_case -> camelCase que list() ci-dessus.
              return {
                id: r.id, createdAt: r.created_at, clientId: r.client_id, employeId: r.employe_id,
                requestId: r.request_id,
                expediteurRole: r.expediteur_role, destinataireRole: r.destinataire_role,
                texte: r.texte, lu: r.lu,
              };
            }
            console.warn('[seba-data] envoi message distant en echec (HTTP ' + res.status + ') — enregistre localement seulement.');
          } catch (e) {
            console.warn('[seba-data] envoi message distant impossible (reseau) — enregistre localement seulement.', e.message);
          }
        }
        // Repli local (pas de Supabase configure, pas de session, ou echec
        // reseau) : meme collection generique que les autres, pour que la
        // messagerie reste utilisable en mode demo/file://.
        const localMsg = Object.assign({ id: uid(), createdAt: todayISO(0), lu: false }, obj);
        state.messages.unshift(localMsg);
        persist();
        return localMsg;
      },
    },

    /* ── Espace Terrain (authentification universelle, 2026-07-19) ──────
       Retire le modele PIN/badge-sur-appareil-patron (setEmployePin/
       employeLogin/employeSession/employeLogout ci-dessus jusqu'a ce
       commit) : sur demande explicite, l'employe doit pouvoir se
       connecter depuis N'IMPORTE QUEL appareil, comme le patron et le
       client. Structure IDENTIQUE a clientPortal ci-dessous (copier-
       coller assume, les deux roles suivent exactement le meme modele) :
       vraie session Supabase Auth independante, provisionnee par
       INVITATION (Edge Function employe-provision.ts), jamais de mot de
       passe impose -- l'employe choisit le sien via le lien recu
       (reset-password.html). seba_employee_session_demo est une cle
       DISTINCTE du DEMO_KEY partage de sebaAuth et de
       seba_client_session_demo -- trois roles "connectes" en demo sur le
       meme navigateur ne doivent jamais se marcher dessus. ── */
    employeePortal: {
      async provision(employeId, email) {
        email = (email || '').trim().toLowerCase();
        if (!email) return { ok: false, error: 'Email requis.' };
        if (hasSupabase && adapter._hasSession(window.SEBA_CONFIG)) {
          try {
            const cfg = window.SEBA_CONFIG;
            const res = await fetch(cfg.supabaseUrl + '/functions/v1/employe-provision', {
              method: 'POST',
              headers: adapter._headers({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ account: adapter._accountId(), employe_id: employeId, email }),
            });
            const respBody = await res.json().catch(() => ({}));
            if (!res.ok) return { ok: false, error: respBody.error || ('Erreur serveur (HTTP ' + res.status + ')') };
            return { ok: true };
          } catch (e) {
            return { ok: false, error: 'Connexion impossible : ' + e.message };
          }
        }
        if (!state) loadState();
        const emp = state.employes.find(e => e.id === employeId);
        if (!emp) return { ok: false, error: 'Employé introuvable.' };
        emp.pwLocal = '1234'; // clair, mode demo/file:// uniquement -- simule un mot de passe deja choisi (pas d'email reel envoye en local)
        persist();
        return { ok: true };
      },

      async login(email, password) {
        email = (email || '').trim().toLowerCase();
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          return sebaAuth.signIn(email, password);
        }
        if (!state) loadState();
        const emp = state.employes.find(e => (e.email || '').trim().toLowerCase() === email);
        if (!emp || !emp.pwLocal || emp.pwLocal !== password) {
          return { ok: false, error: 'Identifiants invalides.' }; // generique -- anti-enumeration
        }
        try { localStorage.setItem('seba_employee_session_demo', JSON.stringify({ email, employeId: emp.id })); } catch (e) {}
        return { ok: true };
      },

      async logout() {
        try { localStorage.removeItem('seba_employee_session_demo'); } catch (e) {}
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) return sebaAuth.signOut();
        return { ok: true };
      },

      async session() {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const s = await sebaAuth.getSession();
          return s ? { supabase: true } : null;
        }
        try {
          const raw = localStorage.getItem('seba_employee_session_demo');
          return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
      },

      /* Profil complet (fiche) de l'employe connecte -- jamais lu
         directement depuis seba_state (RLS refuse : auth.uid() de
         l'employe != user_id du patron proprietaire de la ligne),
         toujours via la RPC dediee. */
      async profile() {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('get_my_employee_profile', {});
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        try {
          const raw = localStorage.getItem('seba_employee_session_demo');
          const demo = raw ? JSON.parse(raw) : null;
          if (!demo) return { ok: false, error: 'Non connecté.' };
          const emp = state.employes.find(e => e.id === demo.employeId);
          if (!emp) return { ok: false, error: 'Fiche introuvable.' };
          return { ok: true, employe: emp, account: 'demo', employe_id: emp.id };
        } catch (e) { return { ok: false, error: e.message }; }
      },

      /* Planning du jour (espace-terrain.html) -- interventions vivent
         dans le blob JSONB du PATRON, RLS de seba_state interdit une
         lecture directe pour l'auth.uid() de l'employe -- RPC dediee,
         meme raison que profile() ci-dessus. _date fourni par
         l'appelant (todayISOLocal(), jamais calcule serveur -- voir
         supabase-schema.sql pour le pourquoi, piege UTC deja rencontre
         sur ce projet). */
      async interventionsForDate(_date) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('get_my_employee_interventions', { _date });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        try {
          const raw = localStorage.getItem('seba_employee_session_demo');
          const demo = raw ? JSON.parse(raw) : null;
          if (!demo) return { ok: false, error: 'Non connecté.' };
          const interventions = state.interventions.filter(i => i.employeId === demo.employeId && i.date === _date);
          return { ok: true, interventions };
        } catch (e) { return { ok: false, error: e.message }; }
      },

      /* Toutes les missions assignees a l'employe connecte, TOUTES dates
         confondues (contrairement a interventionsForDate ci-dessus, scopee
         a un seul jour) -- dashboard employe (mission en cours/prochaine/
         en retard) et liste "Missions" completes, espace-terrain.html.
         RPC dediee get_my_employee_interventions() (SANS argument, surcharge
         de la version datee -- migrations/2026-07-23-employee-portal-missions.sql),
         enrichie cote serveur de l'adresse du client (seul champ ajoute,
         l'employe n'ayant sinon aucun moyen de lire state.clients). Retourne
         toujours un tableau (jamais {ok,...} ici, RPC recente qui suit le
         contrat des RPC clientPortal.devis()/factures()/interventions()). */
      async interventions() {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('get_my_employee_interventions', {});
          return res.error ? [] : (res.data || []);
        }
        if (!state) loadState();
        try {
          const raw = localStorage.getItem('seba_employee_session_demo');
          const demo = raw ? JSON.parse(raw) : null;
          if (!demo) return [];
          const clientsById = {}; state.clients.forEach(c => { clientsById[c.id] = c; });
          return state.interventions
            .filter(i => i.employeId === demo.employeId)
            .map(i => Object.assign({}, i, { adresse: (clientsById[i.clientId] || {}).adresse || '' }));
        } catch (e) { return []; }
      },

      /* Changement de statut simple (Demarrer -> en_cours, Terminer ->
         terminee), distinct de closeIntervention ci-dessous (rapport+photo,
         flux plus lourd deja cable) -- RPC dediee
         update_my_employee_intervention_status, seuls 'en_cours'/'terminee'
         acceptes cote serveur (jamais un statut arbitraire envoye par le
         navigateur, verifie a nouveau ici cote client par simple prudence
         UX, la vraie garantie est serveur). */
      async updateStatus(interventionId, status) {
        if (status !== 'en_cours' && status !== 'terminee') return { ok: false, error: 'Statut non autorisé.' };
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('update_my_employee_intervention_status', {
            p_intervention_id: interventionId, p_status: status,
          });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        try {
          const raw = localStorage.getItem('seba_employee_session_demo');
          const demo = raw ? JSON.parse(raw) : null;
          if (!demo) return { ok: false, error: 'Non connecté.' };
          const interv = state.interventions.find(i => i.id === interventionId);
          if (!interv) return { ok: false, error: 'Intervention inconnue.' };
          if (interv.employeId !== demo.employeId) return { ok: false, error: 'Mission non assignée à vous.' };
          interv.statut = status;
          interv.done = status === 'terminee';
          persist();
          return { ok: true, intervention: interv };
        } catch (e) { return { ok: false, error: e.message }; }
      },

      /* Clôture de mission (espace-terrain.html, "Terminer la mission",
         2026-07-20) -- l'employe n'a AUCUN droit d'ecriture direct ni sur
         seba_state ni sur client_requests (memes RLS que interventionsForDate
         ci-dessus, cote lecture) : RPC SECURITY DEFINER close_my_intervention
         restreinte aux missions ACTUELLEMENT assignees a l'appelant.
         photoPath (2026-07-20b, stockage reel) : chemin retourne par
         sebaAuth.uploadFile('mission-photos', ...) apres upload DIRECT
         depuis le navigateur de l'employe (son propre JWT, jamais
         service_role -- policies RLS du bucket, voir supabase-schema.sql
         section 37) -- l'appelant (espace-terrain.html) fait l'upload
         AVANT d'appeler cette fonction et lui passe le chemin obtenu, ou
         null si pas de photo/upload en echec (ne bloque jamais la
         cloture -- voir espace-terrain.html: validerCloture()). */
      async closeIntervention(interventionId, rapport, photoPath) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('close_my_intervention', {
            _intervention_id: interventionId, _rapport: rapport || null, _photo_path: photoPath || null,
          });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const interv = state.interventions.find(i => i.id === interventionId);
        if (!interv) return { ok: false, error: 'Mission introuvable.' };
        interv.done = true;
        interv.rapport = rapport || null;
        interv.rapportPhotoPath = photoPath || null;
        if (interv.requestId) {
          const req = state.clientRequests.find(r => r.id === interv.requestId);
          if (req) { req.statut = 'terminee'; req.photoPath = photoPath || null; }
        }
        persist();
        return { ok: true };
      },

      /* ═══ INTERVENTION 360 (feature/intervention-360) — exécution côté
         employé. Même schéma pour toutes les méthodes : RPC réelle si une
         session Supabase existe (SECURITY DEFINER, valeurs contrôlées
         côté serveur -- jamais une confiance aveugle au navigateur),
         repli local (mode démo/file://) avec le MÊME garde-fou
         d'assignation que closeIntervention/saveFieldReport ci-dessus.
         Aucun accès direct large à seba_state : chaque méthode ne touche
         que les champs qu'elle est censée modifier. ═══ */
      async getInterventionDetail(interventionId) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('get_my_employee_intervention_detail', { p_intervention_id: interventionId });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Mission introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_employee_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.employeId !== demo.employeId) return { ok: false, error: 'Mission non assignée à vous.' };
        normalizeIntervention(intervention);
        // Même enrichissement que interventions() ci-dessus (adresse
        // absente de l'intervention elle-même, dérivée de la fiche client
        // à la lecture) -- même contrat que la RPC get_my_employee_intervention_detail.
        const client = state.clients.find(c => c.id === intervention.clientId);
        const enriched = Object.assign({}, intervention, { adresse: (client || {}).adresse || '' });
        return { ok: true, intervention: enriched };
      },

      async startIntervention(interventionId) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('start_my_intervention', { p_intervention_id: interventionId });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Mission introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_employee_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.employeId !== demo.employeId) return { ok: false, error: 'Mission non assignée à vous.' };
        normalizeIntervention(intervention);
        intervention.execution.timing.actualStart = new Date().toISOString();
        intervention.execution.completionStatus = 'in_progress';
        intervention.statut = 'en_cours'; // conserve la compat avec le badge legacy (missionStatusKey)
        pushStatusHistory(intervention, 'started', 'employe', demo ? demo.employeId : intervention.employeId);
        persist();
        return { ok: true, intervention };
      },

      async pauseIntervention(interventionId) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('pause_my_intervention', { p_intervention_id: interventionId });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Mission introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_employee_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.employeId !== demo.employeId) return { ok: false, error: 'Mission non assignée à vous.' };
        normalizeIntervention(intervention);
        if (!intervention.execution.timing.actualStart) return { ok: false, error: 'La mission n\'a pas encore démarré.' };
        if (intervention.execution.timing.pausedAt) return { ok: false, error: 'Mission déjà en pause.' };
        intervention.execution.timing.pausedAt = new Date().toISOString();
        intervention.execution.completionStatus = 'paused';
        pushStatusHistory(intervention, 'paused', 'employe', demo ? demo.employeId : intervention.employeId);
        persist();
        return { ok: true, intervention };
      },

      async resumeIntervention(interventionId) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('resume_my_intervention', { p_intervention_id: interventionId });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Mission introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_employee_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.employeId !== demo.employeId) return { ok: false, error: 'Mission non assignée à vous.' };
        normalizeIntervention(intervention);
        if (!intervention.execution.timing.pausedAt) return { ok: false, error: 'Mission non en pause.' };
        const pausedMinutes = Math.round((Date.now() - new Date(intervention.execution.timing.pausedAt).getTime()) / 60000);
        intervention.execution.timing.pausedDurationMinutes = (intervention.execution.timing.pausedDurationMinutes || 0) + Math.max(0, pausedMinutes);
        intervention.execution.timing.pausedAt = null;
        intervention.execution.completionStatus = 'in_progress';
        pushStatusHistory(intervention, 'resumed', 'employe', demo ? demo.employeId : intervention.employeId);
        persist();
        return { ok: true, intervention };
      },

      async updateChecklistItem(interventionId, itemId, patch) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('update_my_intervention_checklist', {
            p_intervention_id: interventionId, p_item_id: itemId, p_checked: !!patch.checked, p_note: patch.note || null,
          });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Mission introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_employee_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.employeId !== demo.employeId) return { ok: false, error: 'Mission non assignée à vous.' };
        normalizeIntervention(intervention);
        const item = intervention.execution.checklist.find(c => c.id === itemId);
        if (!item) return { ok: false, error: 'Tâche introuvable.' };
        item.checked = !!patch.checked;
        item.checkedAt = item.checked ? new Date().toISOString() : null;
        item.checkedBy = item.checked ? (demo ? demo.employeId : intervention.employeId) : null;
        if (patch.note !== undefined) item.note = patch.note || '';
        pushStatusHistory(intervention, 'checklist_updated', 'employe', demo ? demo.employeId : intervention.employeId, { itemId, checked: item.checked });
        persist();
        return { ok: true, intervention };
      },

      async addMaterial(interventionId, material) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('add_my_intervention_material', {
            p_intervention_id: interventionId, p_label: material.label, p_quantity: material.quantity || null, p_unit: material.unit || null, p_note: material.note || null,
          });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Mission introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_employee_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.employeId !== demo.employeId) return { ok: false, error: 'Mission non assignée à vous.' };
        if (!material.label || !material.label.trim()) return { ok: false, error: 'Nom du matériau requis.' };
        normalizeIntervention(intervention);
        intervention.execution.materials.push({ id: uid(), label: material.label.trim(), quantity: material.quantity || null, unit: material.unit || null, note: material.note || '' });
        persist();
        return { ok: true, intervention };
      },

      async submitIncident(interventionId, incident) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('submit_my_intervention_incident', {
            p_intervention_id: interventionId, p_type: incident.type, p_description: incident.description || null,
          });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Mission introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_employee_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.employeId !== demo.employeId) return { ok: false, error: 'Mission non assignée à vous.' };
        if (!incident.type) return { ok: false, error: 'Type d\'incident requis.' };
        normalizeIntervention(intervention);
        const entry = { id: uid(), type: incident.type, description: (incident.description || '').trim(), reportedAt: new Date().toISOString(), reportedBy: demo ? demo.employeId : intervention.employeId };
        intervention.execution.incidents.push(entry);
        pushStatusHistory(intervention, 'incident_reported', 'employe', entry.reportedBy, { type: incident.type });
        persist();
        return { ok: true, intervention };
      },

      /* Upload direct vers intervention360-photos (JWT de l'employe, jamais
         service_role -- les policies RLS du bucket font le travail
         d'autorisation, meme principe que uploadClosurePhoto existant sur
         espace-terrain.html). Mode demo/local : chemin factice de meme
         forme, aucun vrai fichier stocke.
         adapter._accountId() resout auth.uid() DE LA SESSION COURANTE --
         correct pour le patron, FAUX pour un employe (donnerait son
         propre uid, jamais le compte du patron proprietaire de
         seba_state) : meme piege documente pour requests.list() plus haut
         (clientPortal.profile().account, distinct de adapter._accountId()).
         Le chemin de stockage doit porter le compte du PATRON (segment
         verifie par les policies RLS du bucket, storage.foldername(name)[2])
         -- resolu ici via this.profile(), jamais via adapter._accountId(). */
      async addPhoto(interventionId, type, file) {
        if (PHOTO_TYPES.indexOf(type) === -1) return { ok: false, error: 'Type de photo non autorisé.' };
        let storagePath = null, mimeType = file ? file.type : null;
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured && file) {
          const cfg = window.SEBA_CONFIG;
          const profileRes = await this.profile();
          if (!profileRes || !profileRes.ok) return { ok: false, error: 'Profil employé introuvable.' };
          const account = profileRes.account;
          const filename = uid();
          const path = 'accounts/' + account + '/interventions/' + interventionId + '/' + filename;
          const up = await sebaAuth.uploadFile('intervention360-photos', path, file);
          if (!up.ok) return { ok: false, error: 'Envoi de la photo échoué : ' + up.error };
          storagePath = up.path;
        } else if (file) {
          storagePath = 'accounts/demo/interventions/' + interventionId + '/' + uid(); // mode demo : aucun vrai stockage
        } else {
          return { ok: false, error: 'Aucun fichier sélectionné.' };
        }
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('add_my_intervention_photo', {
            p_intervention_id: interventionId, p_type: type, p_storage_path: storagePath, p_mime_type: mimeType,
          });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Mission introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_employee_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.employeId !== demo.employeId) return { ok: false, error: 'Mission non assignée à vous.' };
        normalizeIntervention(intervention);
        const photo = { id: uid(), type, storagePath, mimeType, createdAt: new Date().toISOString(), uploadedBy: demo ? demo.employeId : intervention.employeId, visibleToClient: type === 'after' };
        intervention.execution.photos.push(photo);
        pushStatusHistory(intervention, 'photo_added', 'employe', photo.uploadedBy, { type });
        persist();
        return { ok: true, intervention, photo };
      },

      /* Finalise l'EXÉCUTION (checklist/photos/matériaux) -- distinct de
         saveFieldReport() ci-dessus (retour terrain narratif, déjà câblé
         par le chantier précédent, jamais modifié ici). Bloque exactement
         comme computeInterventionCompletionBlockers() (même fonction pure
         que côté UI, jamais une confiance aveugle au bouton "Terminer"
         déjà désactivé côté client). */
      async completeIntervention(interventionId, notes) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('complete_my_intervention', { p_intervention_id: interventionId, p_notes: notes || null });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Mission introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_employee_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.employeId !== demo.employeId) return { ok: false, error: 'Mission non assignée à vous.' };
        normalizeIntervention(intervention);
        const blockers = computeInterventionCompletionBlockers(intervention);
        if (blockers.length) return { ok: false, error: 'Finalisation impossible.', blockers };
        intervention.execution.timing.actualEnd = new Date().toISOString();
        intervention.execution.completionStatus = 'submitted';
        intervention.execution.submittedAt = new Date().toISOString();
        intervention.done = true;
        pushStatusHistory(intervention, 'completed', 'employe', demo ? demo.employeId : intervention.employeId, { notes: notes || null });
        persist();
        return { ok: true, intervention };
      },

      /* Auto-service : l'employe change son propre mot de passe depuis
         espace-terrain.html, a tout moment -- miroir de
         clientPortal.setPassword() ci-dessous. */
      async setPassword(newPassword) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          return sebaAuth.updatePassword(newPassword);
        }
        if (!state) loadState();
        try {
          const raw = localStorage.getItem('seba_employee_session_demo');
          const demo = raw ? JSON.parse(raw) : null;
          if (!demo) return { ok: false, error: 'Non connecté.' };
          const emp = state.employes.find(e => e.id === demo.employeId);
          if (!emp) return { ok: false, error: 'Fiche introuvable.' };
          emp.pwLocal = newPassword;
          persist();
          return { ok: true };
        } catch (e) { return { ok: false, error: e.message }; }
      },
    },

    /* ── Espace Client (2026-07-19, calque sur le modele employe le
       2026-07-19b) ────────────────────────────────────────────────────
       Meme philosophie que l'employe : le patron provisionne l'acces
       (ici, un vrai compte Supabase Auth via l'Edge Function
       client-provision.ts -- appelee depuis clients.html/client-fiche.html
       des qu'un email est renseigne) PAR INVITATION (auth.admin.
       inviteUserByEmail) -- jamais de mot de passe impose, le client
       choisit le sien via le lien recu (reset-password.html). Plus
       d'auto-inscription ouverte. Authentification universelle
       (2026-07-19) : desormais le MEME modele que l'employe
       (employeePortal ci-dessus, structure identique) -- email tape dans
       les deux cas, vraie session Supabase Auth independante des deux
       cotes. Reutilise sebaAuth.signIn/updatePassword (deja generiques),
       mais JAMAIS le DEMO_KEY partage de sebaAuth en mode demo
       (seba_client_session_demo est une cle distincte, sinon un patron,
       un employe et un client "connectes" en demo sur le meme navigateur
       se marcheraient dessus). ── */
    clientPortal: {
      /* Invite le client par email (Edge Function client-provision.ts,
         service_role -- ne touche jamais a la session du patron qui
         appelle). Appelee par clients.html (creation) et
         client-fiche.html (retrofit si l'email est ajoute apres coup)
         des qu'un email existe. */
      async provision(clientId, email) {
        email = (email || '').trim().toLowerCase();
        if (!email) return { ok: false, error: 'Email requis.' };
        if (hasSupabase && adapter._hasSession(window.SEBA_CONFIG)) {
          try {
            const cfg = window.SEBA_CONFIG;
            const res = await fetch(cfg.supabaseUrl + '/functions/v1/client-provision', {
              method: 'POST',
              headers: adapter._headers({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ account: adapter._accountId(), client_id: clientId, email }),
            });
            const respBody = await res.json().catch(() => ({}));
            if (!res.ok) return { ok: false, error: respBody.error || ('Erreur serveur (HTTP ' + res.status + ')') };
            return { ok: true };
          } catch (e) {
            return { ok: false, error: 'Connexion impossible : ' + e.message };
          }
        }
        if (!state) loadState();
        const client = state.clients.find(c => c.id === clientId);
        if (!client) return { ok: false, error: 'Client introuvable.' };
        client.pwLocal = '1234'; // clair, mode demo/file:// uniquement -- simule un mot de passe deja choisi (pas d'email reel envoye en local)
        persist();
        return { ok: true };
      },

      async login(email, password) {
        email = (email || '').trim().toLowerCase();
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          return sebaAuth.signIn(email, password);
        }
        if (!state) loadState();
        const client = state.clients.find(c => (c.email || '').trim().toLowerCase() === email);
        if (!client || !client.pwLocal) {
          return { ok: false, error: 'Identifiants invalides.' }; // generique -- meme logique anti-enumeration que le PIN employe
        }
        if (client.pwLocal !== password) return { ok: false, error: 'Identifiants invalides.' };
        try { localStorage.setItem('seba_client_session_demo', JSON.stringify({ email, clientId: client.id })); } catch (e) {}
        return { ok: true };
      },

      async logout() {
        try { localStorage.removeItem('seba_client_session_demo'); } catch (e) {}
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) return sebaAuth.signOut();
        return { ok: true };
      },

      async session() {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const s = await sebaAuth.getSession();
          return s ? { supabase: true } : null;
        }
        try {
          const raw = localStorage.getItem('seba_client_session_demo');
          return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
      },

      /* Profil complet (fiche) du client connecte -- jamais lu directement
         depuis seba_state (RLS refuse : auth.uid() du client != user_id du
         patron proprietaire de la ligne), toujours via la RPC dediee. */
      async profile() {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('get_my_client_profile', {});
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        try {
          const raw = localStorage.getItem('seba_client_session_demo');
          const demo = raw ? JSON.parse(raw) : null;
          if (!demo) return { ok: false, error: 'Non connecté.' };
          const client = state.clients.find(c => c.id === demo.clientId);
          if (!client) return { ok: false, error: 'Fiche introuvable.' };
          return { ok: true, client, account: 'demo', client_id: client.id };
        } catch (e) { return { ok: false, error: e.message }; }
      },

      /* Devis/factures/interventions du client connecte -- jamais lus
         directement depuis seba_state en session cloud reelle (RLS refuse,
         meme raison que profile() ci-dessus : ces 3 entites vivent dans le
         blob JSONB du PATRON). Chacune passe par sa RPC SECURITY DEFINER
         dediee (get_my_client_devis/factures/interventions,
         migrations/2026-07-23-client-portal-data-rls.sql), qui retrouve le
         rattachement via client_accounts et filtre explicitement par
         account ET client_id -- jamais tout le blob du patron. En mode
         local/demo (pas de session Supabase reelle), retourne null : le
         appelant lit alors SebaDB.list() directement et filtre lui-meme
         par clientId (chemin deja existant, inchange). */
      async devis() {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('get_my_client_devis', {});
          return res.error ? [] : (res.data || []);
        }
        return null;
      },
      async factures() {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('get_my_client_factures', {});
          return res.error ? [] : (res.data || []);
        }
        return null;
      },
      async interventions() {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('get_my_client_interventions', {});
          return res.error ? [] : (res.data || []);
        }
        return null;
      },

      /* Auto-service : le client change son propre mot de passe depuis
         client-espace.html, a tout moment (miroir de
         employeePortal.setPassword ci-dessus). */
      async setPassword(newPassword) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          return sebaAuth.updatePassword(newPassword);
        }
        if (!state) loadState();
        try {
          const raw = localStorage.getItem('seba_client_session_demo');
          const demo = raw ? JSON.parse(raw) : null;
          if (!demo) return { ok: false, error: 'Non connecté.' };
          const client = state.clients.find(c => c.id === demo.clientId);
          if (!client) return { ok: false, error: 'Fiche introuvable.' };
          client.pwLocal = newPassword;
          persist();
          return { ok: true };
        } catch (e) { return { ok: false, error: e.message }; }
      },

      /* ═══ INTERVENTION 360 (feature/intervention-360) — suivi et
         validation côté client. Même schéma que employeePortal.* : RPC
         réelle si une session existe, repli local (mode démo) avec le même
         garde-fou de rattachement. Le client ne voit JAMAIS les notes
         owner_only ni les données financières -- non pas par filtrage ici
         (l'intervention JSON ne contient aucun montant/marge/solde, ces
         données vivent dans devis/factures, jamais touchées par ces
         méthodes), mais par construction du modèle lui-même. ═══ */
      async getInterventionDetail(interventionId) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('get_my_client_intervention_detail', { p_intervention_id: interventionId });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Intervention introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_client_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.clientId !== demo.clientId) return { ok: false, error: 'Intervention non associée à votre compte.' };
        normalizeIntervention(intervention);
        // Ne renvoie jamais les photos internes (visibleToClient=false) --
        // même filtrage que côté serveur (RPC get_my_client_intervention_detail).
        const safe = Object.assign({}, intervention, {
          execution: Object.assign({}, intervention.execution, { photos: intervention.execution.photos.filter(p => p.visibleToClient) }),
        });
        return { ok: true, intervention: safe };
      },

      async requestReschedule(interventionId, preferredDate, comment) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('request_my_intervention_reschedule', {
            p_intervention_id: interventionId, p_preferred_date: preferredDate || null, p_comment: comment || null,
          });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Intervention introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_client_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.clientId !== demo.clientId) return { ok: false, error: 'Intervention non associée à votre compte.' };
        intervention.rescheduleRequest = { requestedDate: preferredDate || null, comment: (comment || '').trim(), requestedAt: new Date().toISOString(), status: 'pending' };
        SebaDB.update('interventions', interventionId, { rescheduleRequest: intervention.rescheduleRequest });
        return { ok: true, intervention };
      },

      async approveCompletedIntervention(interventionId, comment) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('approve_my_completed_intervention', { p_intervention_id: interventionId, p_comment: comment || null });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Intervention introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_client_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.clientId !== demo.clientId) return { ok: false, error: 'Intervention non associée à votre compte.' };
        normalizeIntervention(intervention);
        if (intervention.execution.completionStatus !== 'submitted') return { ok: false, error: 'La mission n\'est pas encore terminée.' };
        intervention.execution.clientApproval = { status: 'approved', comment: (comment || '').trim(), submittedAt: new Date().toISOString(), submittedBy: demo ? demo.clientId : intervention.clientId };
        pushStatusHistory(intervention, 'client_approved', 'client', intervention.execution.clientApproval.submittedBy);
        persist();
        return { ok: true, intervention };
      },

      async reportIssue(interventionId, comment) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('report_my_intervention_issue', { p_intervention_id: interventionId, p_comment: comment || null });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Intervention introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_client_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.clientId !== demo.clientId) return { ok: false, error: 'Intervention non associée à votre compte.' };
        if (!comment || !comment.trim()) return { ok: false, error: 'Un commentaire est requis pour signaler un problème.' };
        normalizeIntervention(intervention);
        intervention.execution.clientApproval = { status: 'issue_reported', comment: comment.trim(), submittedAt: new Date().toISOString(), submittedBy: demo ? demo.clientId : intervention.clientId };
        pushStatusHistory(intervention, 'client_issue_reported', 'client', intervention.execution.clientApproval.submittedBy, { comment: comment.trim() });
        persist();
        return { ok: true, intervention };
      },

      /* Demandes ("Nouvelle demande", client-espace.html). Accessible cote
         client (ses propres demandes) ET cote patron (client-fiche.html --
         RLS client_requests_select autorise les deux, voir schema). */
      requests: {
        /* account optionnel : un client fournit toujours le sien (via
           clientPortal.profile().account, distinct de son propre
           auth.uid()) ; le patron peut l'omettre, il retombe alors sur
           adapter._accountId() (correct pour LUI -- meme defaut que
           messages.send/list plus haut).
           clientId optionnel : omis, renvoie TOUTES les demandes du
           compte (patron uniquement -- assignation.html, "Tour de
           controle") ; fourni, filtre sur un client precis (client-fiche.html,
           client-espace.html). RLS client_requests_select autorise deja
           le patron a lire toutes les lignes de son account. */
        async list(account, clientId) {
          if (hasSupabase && adapter._hasSession(window.SEBA_CONFIG)) {
            try {
              const cfg = window.SEBA_CONFIG;
              account = account || adapter._accountId();
              let url = cfg.supabaseUrl + '/rest/v1/client_requests?account=eq.' + encodeURIComponent(account);
              if (clientId) url += '&client_id=eq.' + encodeURIComponent(clientId);
              url += '&order=created_at.desc';
              const res = await fetch(url, { headers: adapter._headers() });
              if (res.ok) {
                const rows = await res.json();
                return rows.map(r => ({
                  id: r.id, clientId: r.client_id, titre: r.titre, statut: r.statut,
                  intervenantId: r.intervenant_id, intervenantNom: r.intervenant_nom,
                  interventionId: r.intervention_id, photoPath: r.photo_path, createdAt: r.created_at,
                }));
              }
              console.warn('[seba-data] lecture demandes distante en echec (HTTP ' + res.status + ') — repli local.');
            } catch (e) { console.warn('[seba-data] lecture demandes distante impossible (reseau)', e.message); }
          }
          if (!state) loadState();
          return state.clientRequests.filter(r => !clientId || r.clientId === clientId);
        },
        async create(account, clientId, titre) {
          if (hasSupabase && adapter._hasSession(window.SEBA_CONFIG)) {
            try {
              const cfg = window.SEBA_CONFIG;
              const res = await fetch(cfg.supabaseUrl + '/rest/v1/client_requests', {
                method: 'POST',
                headers: adapter._headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
                body: JSON.stringify({ account, client_id: clientId, titre }),
              });
              if (res.ok) {
                const rows = await res.json();
                const r = rows[0];
                return { id: r.id, clientId: r.client_id, titre: r.titre, statut: r.statut, intervenantId: r.intervenant_id, intervenantNom: r.intervenant_nom, createdAt: r.created_at };
              }
              console.warn('[seba-data] creation demande distante en echec (HTTP ' + res.status + ') — enregistree localement seulement.');
            } catch (e) { console.warn('[seba-data] creation demande distante impossible (reseau)', e.message); }
          }
          if (!state) loadState();
          const item = { id: uid(), clientId, titre, statut: 'nouvelle', intervenantId: null, intervenantNom: null, interventionId: null, photoPath: null, createdAt: todayISO(0) };
          state.clientRequests.unshift(item);
          persist();
          return item;
        },
        /* Cote patron uniquement (client-fiche.html, assignation.html) :
           assigner un intervenant / changer le statut / relier la
           mission creee. RLS client_requests_update n'autorise que le
           proprietaire du compte (voir schema). */
        async update(requestId, patch) {
          if (hasSupabase && adapter._hasSession(window.SEBA_CONFIG)) {
            try {
              const cfg = window.SEBA_CONFIG;
              const body = {};
              if (patch.statut !== undefined) body.statut = patch.statut;
              if (patch.intervenantId !== undefined) body.intervenant_id = patch.intervenantId;
              if (patch.intervenantNom !== undefined) body.intervenant_nom = patch.intervenantNom;
              if (patch.interventionId !== undefined) body.intervention_id = patch.interventionId;
              body.updated_at = new Date().toISOString();
              const res = await fetch(cfg.supabaseUrl + '/rest/v1/client_requests?id=eq.' + encodeURIComponent(requestId), {
                method: 'PATCH',
                headers: adapter._headers({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
              });
              return { ok: res.ok };
            } catch (e) { return { ok: false, error: e.message }; }
          }
          if (!state) loadState();
          const item = state.clientRequests.find(r => r.id === requestId);
          if (item) { Object.assign(item, patch); persist(); }
          return { ok: !!item };
        },
      },
    },

    /* Chiffres réels calculés — consommés par le dashboard */
    metrics() {
      if (!state) loadState();
      const month = todayISO(0).slice(0, 7);
      const caMois = state.factures.filter(f => f.status === 'payee' && (f.paidAt || f.date || '').startsWith(month))
        .reduce((s, f) => s + (f.amount || 0), 0);
      const caTotal = state.factures.filter(f => f.status === 'payee').reduce((s, f) => s + (f.amount || 0), 0);
      const interventionsMois = state.interventions.filter(i => (i.date || '').startsWith(month)).length;
      const today = todayISO(0);
      return {
        caMois, caTotal, interventionsMois,
        clientsActifs: state.clients.filter(c => c.statut === 'actif').length,
        clientsTotal: state.clients.length,
        devisAttente: state.devis.filter(d => d.status === 'attente').length,
        facturesRetard: state.factures.filter(f => f.status === 'retard').length,
        interventionsJour: state.interventions.filter(i => i.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || '')),
      };
    },

    onChange(fn) {
      listeners.push(fn);
      // synchro entre onglets
      window.addEventListener('storage', e => { if (e.key === DB_KEY) { state = null; loadState(); fn(); } });
    },

    exportJSON() { if (!state) loadState(); return JSON.stringify(state, null, 2); },
    /* Restauration complete depuis une sauvegarde -- reste une operation
       LOCALE uniquement (pas de re-sync automatique vers Supabase) :
       pousser potentiellement des centaines d'entites d'un coup meriterait
       sa propre reflexion (collision d'ids avec l'existant cote serveur,
       ordre, volumetrie) plutot qu'un simple forEach(pushOp) improvise ici.
       Perimetre volontairement laisse pour une iteration dediee. */
    importJSON(str) {
      const parsed = JSON.parse(str); // laisse remonter l'erreur si invalide
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.clients)) throw new Error('Format de sauvegarde invalide');
      state = Object.assign(EMPTY(), parsed);
      persist();
    },

    /* Suppression réelle (Art. 17 RGPD — droit à l'effacement). Avant ce
       correctif, "Supprimer mon entreprise" ne vidait que le localStorage :
       la ligne seba_state restait sur Supabase pour tout compte connecté au
       cloud. Supprime maintenant la ligne cloud (RLS: auth.uid()=user_id
       autorise l'utilisateur à supprimer sa propre ligne) en plus du local.
       Ne supprime PAS l'identité Supabase Auth elle-même (email/mot de
       passe) : ça nécessite la clé service_role côté serveur, hors de
       portée d'un appel client — seules les données métier sont effacées.

       GAP CONNU depuis le Palier 1, non traite ici : sync_operations est
       append-only PAR CONCEPTION (aucune policy delete, voir
       supabase-schema.sql section 7) et peut contenir des donnees
       personnelles dans ses colonnes patch (noms/emails de clients). Une
       vraie conformite Art. 17 demanderait une anonymisation server-side
       (service_role) de ces lignes, pas une suppression client -- hors
       perimetre de ce refactor, a traiter dans une iteration dediee avant
       toute mise en production reelle de la synchro. Idem pour
       client_accounts/employe_accounts (liens de connexion, contiennent un
       email), non purges ici -- et pour l'identite Supabase Auth du
       client/employe invite elle-meme (necessite service_role). */
    async eraseAllData() {
      if (hasSupabase) {
        const cfg = window.SEBA_CONFIG;
        try {
          await fetch(cfg.supabaseUrl + '/rest/v1/seba_state?account=eq.' + encodeURIComponent(SupabaseAdapter._accountId()), {
            method: 'DELETE',
            headers: SupabaseAdapter._headers(),
          });
        } catch (e) { /* hors ligne : la suppression locale a quand même lieu ci-dessous */ }
      }
      try { localStorage.removeItem(DB_KEY); } catch (e) {}
      state = EMPTY();
    },

    // Local uniquement, aucun pushOp() de suppression en masse : les
    // donnees de demo effacees ici n'ont jamais ete de vraies donnees
    // metier a synchroniser. Ce qui est saisi APRES ce reset repasse par
    // create()/update() normalement et se synchronise comme d'habitude.
    _reset() { state = EMPTY(); persist(); },

    /* ═══ Mémoire client + plans récurrents (feature/client-crm-advanced) ═══
       Écriture patron UNIQUEMENT (même droits que le reste de seba_state --
       aucune policy dédiée nécessaire, l'employé n'a de toute façon aucun
       accès direct à cette table, voir sécurité section 11 du chantier).
       Toute écriture passe par SebaDB.update('clients', ...), donc par le
       même pushOp()/sync que le reste -- aucune architecture parallèle. */
    clients: {
      normalizeOperationalMemory(client) { return normalizeClientOperationalMemory(client); },

      /* Primitive de persistance -- toutes les méthodes ci-dessous
         convergent ici pour ne jamais désynchroniser l'écriture locale et
         le patch poussé au serveur. */
      updateOperationalMemory(clientId, entries) {
        if (!state) loadState();
        const client = state.clients.find(c => c.id === clientId);
        if (!client) return null;
        client.operationalMemory = { entries: entries || [] };
        SebaDB.update('clients', clientId, { operationalMemory: client.operationalMemory });
        return client.operationalMemory;
      },

      addMemoryEntry(clientId, entryData) {
        if (!state) loadState();
        const client = state.clients.find(c => c.id === clientId);
        if (!client) return null;
        normalizeClientOperationalMemory(client);
        if (MEMORY_TYPES.indexOf(entryData.type) === -1) return null;
        const now = new Date().toISOString();
        const entry = {
          id: uid(), type: entryData.type, title: (entryData.title || '').trim(), content: (entryData.content || '').trim(),
          visibility: MEMORY_VISIBILITY.indexOf(entryData.visibility) !== -1 ? entryData.visibility : 'internal_team',
          importance: MEMORY_IMPORTANCE.indexOf(entryData.importance) !== -1 ? entryData.importance : 'normal',
          source: MEMORY_SOURCE.indexOf(entryData.source) !== -1 ? entryData.source : 'manual',
          pinned: !!entryData.pinned, createdAt: now, updatedAt: now, archivedAt: null,
        };
        const entries = client.operationalMemory.entries.concat([entry]);
        this.updateOperationalMemory(clientId, entries);
        SebaDB.log('client', 'Information ajoutée à la mémoire — ' + fullName(client) + ' (' + entry.type + ')', 'client-fiche.html?id=' + clientId);
        return entry;
      },

      updateMemoryEntry(clientId, entryId, patch) {
        if (!state) loadState();
        const client = state.clients.find(c => c.id === clientId);
        if (!client) return null;
        normalizeClientOperationalMemory(client);
        let updated = null;
        const entries = client.operationalMemory.entries.map(e => {
          if (e.id !== entryId) return e;
          updated = Object.assign({}, e, patch, { updatedAt: new Date().toISOString() });
          return updated;
        });
        if (!updated) return null;
        this.updateOperationalMemory(clientId, entries);
        return updated;
      },

      archiveMemoryEntry(clientId, entryId) { return this.updateMemoryEntry(clientId, entryId, { archivedAt: new Date().toISOString() }); },
      restoreMemoryEntry(clientId, entryId) { return this.updateMemoryEntry(clientId, entryId, { archivedAt: null }); },
      pinMemoryEntry(clientId, entryId, pinned) { return this.updateMemoryEntry(clientId, entryId, { pinned: !!pinned }); },

      saveServicePlan(clientId, planData) {
        if (!state) loadState();
        const client = state.clients.find(c => c.id === clientId);
        if (!client) return null;
        normalizeClientOperationalMemory(client);
        const now = new Date().toISOString();
        let plan;
        if (planData.id) {
          plan = client.servicePlans.find(p => p.id === planData.id);
          if (!plan) return null;
          Object.assign(plan, planData, { updatedAt: now });
        } else {
          plan = Object.assign(
            { id: uid(), active: true, autoCreate: false, horizonDays: 30, weekdays: [], instructions: '', assignedEmployeeId: null, endDate: null, createdAt: now, updatedAt: now },
            planData,
          );
          client.servicePlans.push(plan);
        }
        SebaDB.update('clients', clientId, { servicePlans: client.servicePlans });
        SebaDB.log('client', (planData.id ? 'Plan récurrent modifié — ' : 'Plan récurrent créé — ') + fullName(client) + ' (' + plan.name + ')', 'client-fiche.html?id=' + clientId);
        return plan;
      },

      deleteServicePlan(clientId, planId) {
        if (!state) loadState();
        const client = state.clients.find(c => c.id === clientId);
        if (!client) return false;
        normalizeClientOperationalMemory(client);
        const before = client.servicePlans.length;
        const plan = client.servicePlans.find(p => p.id === planId);
        client.servicePlans = client.servicePlans.filter(p => p.id !== planId);
        SebaDB.update('clients', clientId, { servicePlans: client.servicePlans });
        if (plan) SebaDB.log('client', 'Plan récurrent supprimé — ' + fullName(client) + ' (' + plan.name + ')', 'client-fiche.html?id=' + clientId);
        return client.servicePlans.length < before;
      },

      suspendServicePlan(clientId, planId) {
        const p = this.saveServicePlan(clientId, { id: planId, active: false });
        return p;
      },
      reactivateServicePlan(clientId, planId) {
        const p = this.saveServicePlan(clientId, { id: planId, active: true });
        return p;
      },

      /* Prévisualisation SANS écriture -- consomme uniquement la partie pure
         (computeServicePlanOccurrences), pour un bouton "Prévisualiser les
         prochaines occurrences" qui ne doit jamais créer de données. */
      previewServicePlanOccurrences(clientId, planId, horizonDaysOverride) {
        if (!state) loadState();
        const client = state.clients.find(c => c.id === clientId);
        if (!client) return { toCreate: [], toSkip: [] };
        normalizeClientOperationalMemory(client);
        const plan = client.servicePlans.find(p => p.id === planId);
        if (!plan) return { toCreate: [], toSkip: [] };
        return computeServicePlanOccurrences(plan, state.interventions || [], new Date(), horizonDaysOverride || plan.horizonDays || 30);
      },

      /* Génère les occurrences réelles (planning) pour un plan -- idempotent,
         voir persistServicePlanOccurrences(). Journalise le résultat
         même si 0 créée (relance sans effet, comportement attendu). */
      generateServicePlanOccurrences(clientId, planId, horizonDaysOverride) {
        if (!state) loadState();
        const client = state.clients.find(c => c.id === clientId);
        if (!client) return { created: 0, skipped: 0, occurrences: [], error: 'Client introuvable.' };
        normalizeClientOperationalMemory(client);
        const plan = client.servicePlans.find(p => p.id === planId);
        if (!plan) return { created: 0, skipped: 0, occurrences: [], error: 'Plan introuvable.' };
        // Garde-fou explicite : un plan suspendu ne génère JAMAIS de mission
        // -- computeOccurrenceDates() (pure) n'a pas connaissance de
        // "active", c'est cette couche (écriture) qui refuse l'appel.
        if (!plan.active) return { created: 0, skipped: 0, occurrences: [], error: 'Ce plan est suspendu -- réactivez-le avant de générer des interventions.' };
        const result = persistServicePlanOccurrences(client, plan, state, horizonDaysOverride || plan.horizonDays || 30);
        if (result.created > 0) {
          SebaDB.log('intervention', result.created + ' intervention(s) générée(s) — ' + fullName(client) + ' (' + plan.name + ')', 'planning.html');
        }
        return result;
      },
    },

    /* ═══ Briefing de mission + retour terrain (feature/client-crm-advanced) ═══ */
    interventions: {
      /* Patron uniquement (accès direct à seba_state) -- régénère le
         snapshot missionBrief à partir de l'état ACTUEL de la mémoire
         client (jamais automatique après coup : bouton explicite, voir
         client-fiche.html/dashboard.html). */
      regenerateMissionBrief(interventionId) {
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return null;
        const client = state.clients.find(c => c.id === intervention.clientId);
        if (!client) return null;
        normalizeClientOperationalMemory(client);
        const brief = generateMissionBrief(client, intervention, state);
        SebaDB.update('interventions', interventionId, { missionBrief: brief });
        SebaDB.log('intervention', 'Briefing de mission régénéré — ' + fullName(client) + ' (' + (intervention.service || '') + ')', 'client-fiche.html?id=' + client.id);
        return brief;
      },

      /* Employé (session réelle) : passe par la RPC dédiée
         submit_my_intervention_field_report (RLS bloque toute écriture
         directe sur seba_state pour ce rôle -- même pattern que
         closeIntervention/updateStatus déjà en place, voir
         migrations/2026-07-24-mission-field-report.sql). Mode démo/local :
         écriture directe avec le même garde-fou d'assignation. */
      async saveFieldReport(interventionId, fieldReportData) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('submit_my_intervention_field_report', {
            p_intervention_id: interventionId,
            p_outcome: fieldReportData.outcome,
            p_summary: fieldReportData.summary || null,
            p_issue_type: fieldReportData.issueType || 'none',
            p_issue_description: fieldReportData.issueDescription || null,
            p_follow_up_required: !!fieldReportData.followUpRequired,
            p_follow_up_date: fieldReportData.followUpDate || null,
          });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Intervention introuvable.' };
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_employee_session_demo') || 'null'); } catch (e) {}
        if (demo && intervention.employeId !== demo.employeId) return { ok: false, error: 'Mission non assignée à vous.' };
        const fieldReport = {
          completedAt: new Date().toISOString(), outcome: fieldReportData.outcome,
          summary: (fieldReportData.summary || '').trim(), issueType: fieldReportData.issueType || 'none',
          issueDescription: (fieldReportData.issueDescription || '').trim(), followUpRequired: !!fieldReportData.followUpRequired,
          followUpDate: fieldReportData.followUpDate || null,
          submittedBy: demo ? demo.employeId : (intervention.employeId || null), submittedAt: new Date().toISOString(),
          dismissedSuggestionIds: [], acceptedSuggestionIds: [],
        };
        fieldReport.memorySuggestions = generateMemorySuggestions(fieldReport, intervention);
        SebaDB.update('interventions', interventionId, { fieldReport, done: true });
        const client = state.clients.find(c => c.id === intervention.clientId);
        SebaDB.log('intervention', 'Retour terrain reçu — ' + (client ? fullName(client) : 'client') + (intervention.service ? ' (' + intervention.service + ')' : ''), 'client-fiche.html?id=' + intervention.clientId);
        return { ok: true, intervention: SebaDB.get('interventions', interventionId) };
      },

      /* Patron uniquement : transforme une suggestion (issue d'un
         fieldReport) en vraie entrée operationalMemory. Jamais automatique. */
      acceptMemorySuggestion(interventionId, suggestionId, overridePatch) {
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention || !intervention.fieldReport) return { ok: false, error: 'Retour terrain introuvable.' };
        const suggestion = (intervention.fieldReport.memorySuggestions || []).find(s => s.id === suggestionId);
        if (!suggestion) return { ok: false, error: 'Suggestion introuvable.' };
        const client = state.clients.find(c => c.id === intervention.clientId);
        if (!client) return { ok: false, error: 'Client introuvable.' };
        const entryData = Object.assign({}, suggestion.entry, overridePatch || {}, { source: 'intervention_report' });
        const entry = SebaDB.clients.addMemoryEntry(client.id, entryData);
        const accepted = (intervention.fieldReport.acceptedSuggestionIds || []).concat([suggestionId]);
        SebaDB.update('interventions', interventionId, { fieldReport: Object.assign({}, intervention.fieldReport, { acceptedSuggestionIds: accepted }) });
        return { ok: true, entry };
      },

      /* Une suggestion ignorée ne doit plus jamais réapparaître POUR CE
         RAPPORT -- persisté sur fieldReport.dismissedSuggestionIds, jamais
         seulement en mémoire d'affichage. */
      dismissMemorySuggestion(interventionId, suggestionId) {
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention || !intervention.fieldReport) return { ok: false };
        const dismissed = (intervention.fieldReport.dismissedSuggestionIds || []).concat([suggestionId]);
        SebaDB.update('interventions', interventionId, { fieldReport: Object.assign({}, intervention.fieldReport, { dismissedSuggestionIds: dismissed }) });
        return { ok: true };
      },

      /* ═══ INTERVENTION 360 (feature/intervention-360) — préparation et
         contrôle côté patron. Accès direct à seba_state (même modèle que
         les méthodes ci-dessus) -- le patron a déjà tous les droits sur
         son propre compte, aucune RPC nécessaire ici (contrairement aux
         écritures employé/client, restreintes par RLS). ═══ */
      addChecklistItem(interventionId, label, required) {
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention || !label || !label.trim()) return null;
        normalizeIntervention(intervention);
        const item = Object.assign({ id: uid(), label: label.trim() }, CHECKLIST_ITEM_DEFAULTS, { required: !!required });
        intervention.execution.checklist.push(item);
        SebaDB.update('interventions', interventionId, { execution: intervention.execution });
        return item;
      },
      removeChecklistItem(interventionId, itemId) {
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return false;
        normalizeIntervention(intervention);
        const before = intervention.execution.checklist.length;
        intervention.execution.checklist = intervention.execution.checklist.filter(c => c.id !== itemId);
        SebaDB.update('interventions', interventionId, { execution: intervention.execution });
        return intervention.execution.checklist.length < before;
      },
      /* Prépare/réassigne une mission -- adresse/employé/horaires/durée/
         consignes/exigences photo. Simple SebaDB.update() : ces champs sont
         déjà librement modifiables par le patron (aucune RLS ne les
         restreint), inutile de dupliquer une méthode dédiée pour chacun --
         les pages appelantes utilisent directement SebaDB.update('interventions',
         id, {...}) pour la préparation, et pushStatusHistory() ici
         uniquement pour l'événement "prepared"/"assigned" (historique
         explicite, jamais fabriqué après coup). */
      prepareIntervention(interventionId, patch) {
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return null;
        normalizeIntervention(intervention);
        const wasUnassigned = !intervention.employeId;
        const willBeAssigned = patch.employeId !== undefined ? patch.employeId : intervention.employeId;
        if (willBeAssigned && wasUnassigned) pushStatusHistory(intervention, 'assigned', 'patron', null, { employeId: willBeAssigned });
        else pushStatusHistory(intervention, 'prepared', 'patron', null, null);
        SebaDB.update('interventions', interventionId, Object.assign({}, patch, { statusHistory: intervention.statusHistory }));
        return SebaDB.get('interventions', interventionId);
      },

      /* Approuve le dossier terminé (après validation client, ou
         directement si le patron n'attend pas de validation client) --
         complète la boucle "submitted -> owner_approved". */
      ownerApproveIntervention(interventionId, reviewerId) {
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Intervention introuvable.' };
        normalizeIntervention(intervention);
        if (intervention.execution.completionStatus !== 'submitted') return { ok: false, error: 'La mission doit être terminée avant validation.' };
        intervention.execution.completionStatus = 'owner_approved';
        intervention.execution.reviewedAt = new Date().toISOString();
        intervention.execution.reviewedBy = reviewerId || null;
        pushStatusHistory(intervention, 'owner_approved', 'patron', reviewerId || null);
        SebaDB.update('interventions', interventionId, { execution: intervention.execution, statusHistory: intervention.statusHistory });
        SebaDB.log('intervention', 'Dossier de mission validé — ' + (intervention.clientName || 'client') + (intervention.service ? ' (' + intervention.service + ')' : ''), 'intervention-fiche.html?id=' + interventionId);
        return { ok: true, intervention: SebaDB.get('interventions', interventionId) };
      },

      /* Rouvre un dossier incomplet -- remet l'exécution en cours, ne
         supprime AUCUNE donnée déjà saisie (checklist/photos/matériaux/
         incidents restent, seul completionStatus change) : l'employé
         reprend exactement là où il en était. */
      reopenIntervention(interventionId, reason) {
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Intervention introuvable.' };
        normalizeIntervention(intervention);
        intervention.execution.completionStatus = 'reopened';
        intervention.execution.submittedAt = null;
        intervention.done = false;
        pushStatusHistory(intervention, 'reopened', 'patron', null, { reason: reason || null });
        SebaDB.update('interventions', interventionId, { execution: intervention.execution, statusHistory: intervention.statusHistory, done: false });
        SebaDB.log('intervention', 'Mission rouverte — ' + (intervention.clientName || 'client') + (reason ? ' : ' + reason : ''), 'intervention-fiche.html?id=' + interventionId);
        return { ok: true, intervention: SebaDB.get('interventions', interventionId) };
      },

      /* Crée une facture PRÉREMPLIE à partir d'une intervention validée --
         ne facture jamais automatiquement (le patron reste sur factures-
         nouvelle.html/factures.html pour finaliser/envoyer), simplement
         pré-remplit le strict nécessaire (client/service/date) pour éviter
         une ressaisie. Exige "owner_approved" -- jamais une intervention
         encore en cours. */
      createInvoiceFromIntervention(interventionId) {
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Intervention introuvable.' };
        normalizeIntervention(intervention);
        if (intervention.execution.completionStatus !== 'owner_approved') return { ok: false, error: 'Le dossier doit être validé avant de facturer.' };
        if (intervention.invoiceId) return { ok: false, error: 'Une facture existe déjà pour cette intervention.' };
        const facture = SebaDB.create('factures', {
          num: SebaDB.nextNum('facture'), clientId: intervention.clientId, clientName: intervention.clientName || '',
          service: intervention.service || '', amount: 0, status: 'attente', date: todayISO(0), paidAt: null,
          interventionId: intervention.id,
        });
        pushStatusHistory(intervention, 'invoice_created', 'patron', null, { factureId: facture.id });
        SebaDB.update('interventions', interventionId, { invoiceId: facture.id, statusHistory: intervention.statusHistory });
        SebaDB.log('facture', 'Facture préremplie créée depuis la mission — ' + (intervention.clientName || 'client') + ' · ' + facture.num, 'factures.html');
        return { ok: true, facture };
      },
    },
  };

  window.SebaDB = SebaDB;

  /* Fonctions pures de la mémoire/intelligence client -- réutilisées telles
     quelles par client-fiche.html, app/dashboard.html et espace-terrain.html
     (briefing uniquement côté employé). Voir l'en-tête de section plus haut. */
  window.SebaClientIntelligence = {
    normalizeClientOperationalMemory, buildClientOperationalSummary, buildClientNextBestActions,
    computeOccurrenceDates, computeServicePlanOccurrences, persistServicePlanOccurrences, generateMissionBrief, generateMemorySuggestions,
    MEMORY_TYPES, MEMORY_VISIBILITY, MEMORY_IMPORTANCE, MEMORY_SOURCE,
    // Intervention 360 (feature/intervention-360)
    normalizeIntervention, computeInterventionCompletionBlockers,
    PHOTO_TYPES, CLIENT_APPROVAL_STATUSES, COMPLETION_STATUSES, STATUS_HISTORY_EVENTS,
  };

  SebaDB.ready();
})();
