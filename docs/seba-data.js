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
    // feature/automation-engine-foundation : moteur de règles patron,
    // aucun accès employé/client, écritures directes RLS seba_state.
    automationRules: [], automationRuns: [], automationAlerts: [],
    // feature/public-intake-conversion : entreprise = infos publiques (nom
    // etc.) désormais synchronisées côté serveur (avant ce chantier,
    // sebaEntreprise ne vivait QUE dans localStorage -- inutilisable par
    // l'Edge Function public-intake, qui tourne côté serveur sans accès au
    // navigateur du patron). publicIntakeConfig : réglages du formulaire
    // public (désactivé par défaut). Voir SebaDB.entreprise/publicIntake.
    entreprise: null, publicIntakeConfig: null,
    seq: { devis: 118, facture: 93, contrat: 0, recu: 0 },
    // feature/flexible-commercial-documents : numérotation configurable par
    // type de document (préfixe/année/longueur du compteur) -- le COMPTEUR
    // lui-même reste state.seq.* (mécanisme déjà fiable, jamais dupliqué),
    // seul le FORMAT d'affichage devient configurable. documentDisplayPrefs :
    // préférences d'affichage par défaut des documents (montrer logo/IBAN/
    // colonnes...), surchargeables par document via documentOptions.
    documentNumbering: null, documentDisplayPrefs: null,
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
    if (state.entreprise === undefined) state.entreprise = null;
    if (state.publicIntakeConfig === undefined) state.publicIntakeConfig = null;
    if (!state.seq.recu) state.seq.recu = 0;
    if (state.documentNumbering === undefined) state.documentNumbering = null;
    if (state.documentDisplayPrefs === undefined) state.documentDisplayPrefs = null;
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
  const STATUS_HISTORY_EVENTS = ['prepared', 'assigned', 'started', 'paused', 'resumed', 'checklist_updated', 'photo_added', 'incident_reported', 'completed', 'client_approved', 'client_issue_reported', 'owner_approved', 'reopened', 'invoice_created', 'rescheduled', 'reassigned', 'reschedule_request_accepted', 'reschedule_request_declined'];

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

  /* ═══════════════════════════════════════════════════════════════════
     MOTEUR D'AUTOMATISATIONS (feature/automation-engine-foundation)

     QUAND un événement métier arrive / SI des conditions sont vraies /
     ALORS Seba exécute une ou plusieurs actions. Réutilise les objets
     existants (clients/devis/factures/interventions/employés) -- jamais
     de duplication de logique métier (les créations de facture passent
     par SebaDB.factures.createFromDevis/SebaDB.interventions.
     createInvoiceFromIntervention déjà écrits pour quote-to-cash/
     Intervention 360, jamais réécrites ici).

     Séparation stricte évaluation/planification/écriture :
       - normalizeAutomationRule/validateAutomationRule/
         evaluateAutomationConditions/planAutomationActions/
         resolveAutomationFieldValue/resolveClientIdForEvent : PURES,
         aucun appel SebaDB, aucune écriture.
       - executeAutomationRule/processBusinessEvent : orchestrateurs
         d'écriture désignés (les seuls autorisés à appeler SebaDB.create/
         update via SebaDB.automations._runAction).

     Détection d'événements : PAS d'instrumentation de chaque site
     d'écriture (des dizaines de pages) -- une fonction de scan unique
     (detectBusinessEvents) relit l'état APRÈS écriture (jamais un
     recalcul de statut, une simple lecture de champ déjà calculé
     ailleurs) et compare aux automationRuns déjà enregistrés pour
     décider ce qui est "nouveau". Déclenchée par SebaDB.onChange (déjà
     le mécanisme réactif existant de toute l'app, jamais un setInterval/
     polling) -- couvre à la fois les écritures locales du patron ET les
     écritures serveur (RPC client/employé) rapatriées par
     SupabaseAdapter.pull(), qui appelle aussi persist(). ═══════════════ */

  const AUTOMATION_TRIGGER_TYPES = [
    'client_created', 'quote_sent', 'quote_accepted', 'quote_rejected',
    'invoice_issued', 'invoice_partially_paid', 'invoice_paid', 'invoice_overdue',
    'intervention_created', 'intervention_assigned', 'intervention_completed', 'intervention_owner_approved',
    'client_reschedule_requested', 'client_issue_reported', 'employee_unavailability_requested',
    // feature/public-intake-conversion : source réelle = table dédiée
    // public_service_requests, PAS une collection seba_state -- absente de
    // AUTOMATION_SOURCE_COLLECTION (voir plus bas), donc source.<champ> ne
    // se résout jamais pour ces 2 triggers, seul event.<champ> fonctionne
    // (émis explicitement avec toutes les données utiles, voir demandes.html).
    'service_request_created', 'service_request_converted',
  ];
  const AUTOMATION_ACTION_TYPES = ['create_follow_up_intervention', 'create_invoice_draft', 'add_client_memory_entry', 'create_owner_alert', 'update_intervention_status'];
  const AUTOMATION_CONDITION_OPERATORS = ['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_set', 'is_not_set'];
  const AUTOMATION_MAX_ACTIVE_RULES = 20;
  const AUTOMATION_MAX_ACTIONS_PER_RULE = 5;
  const AUTOMATION_MAX_CONDITIONS_PER_RULE = 10;
  const AUTOMATION_MAX_CHAIN_DEPTH = 10;
  // sourceType (événement) -> collection seba_state correspondante.
  const AUTOMATION_SOURCE_COLLECTION = { client: 'clients', devis: 'devis', facture: 'factures', intervention: 'interventions', employee: 'employes' };

  /* Modèles activables (section 5 du chantier) -- de VRAIES règles
     modifiables une fois créées via SebaDB.automations.createFromTemplate(),
     jamais codées en dur dans le moteur lui-même. Toujours créées
     `active:false` (le patron active explicitement après relecture). */
  const AUTOMATION_TEMPLATES = [
    {
      id: 'quote_accepted_invoice', name: 'Devis accepté → facture brouillon',
      trigger: { type: 'quote_accepted', filters: {} }, conditions: [],
      actions: [{ type: 'create_invoice_draft', config: {} }],
    },
    {
      id: 'intervention_approved_invoice', name: 'Intervention validée → facture brouillon',
      trigger: { type: 'intervention_owner_approved', filters: {} }, conditions: [],
      actions: [{ type: 'create_invoice_draft', config: {} }],
    },
    {
      id: 'client_issue_alert', name: 'Problème client → alerte + mémoire',
      trigger: { type: 'client_issue_reported', filters: {} }, conditions: [],
      actions: [
        { type: 'create_owner_alert', config: { title: 'Problème signalé par un client', message: '{{comment}}', priority: 'high' } },
        { type: 'add_client_memory_entry', config: { category: 'quality', contentTemplate: 'Problème signalé : {{comment}}', visibility: 'internal_team' } },
      ],
    },
    {
      id: 'reschedule_alert', name: 'Demande de report → alerte',
      trigger: { type: 'client_reschedule_requested', filters: {} }, conditions: [],
      actions: [{ type: 'create_owner_alert', config: { title: 'Demande de report client', message: 'Nouvelle date souhaitée : {{requestedDate}}', priority: 'medium' } }],
    },
    {
      id: 'followup_after_completion', name: 'Suivi après intervention',
      trigger: { type: 'intervention_completed', filters: {} },
      conditions: [{ field: 'event.service', operator: 'equals', value: '' }],
      actions: [{ type: 'create_follow_up_intervention', config: { delayDays: 30, service: '', duration: null, assignEmployeeId: null, copyClient: true, copyAddress: true } }],
    },
    {
      id: 'service_request_received_alert', name: 'Nouvelle demande reçue',
      trigger: { type: 'service_request_created', filters: {} }, conditions: [],
      actions: [{ type: 'create_owner_alert', config: { title: 'Nouvelle demande publique', message: '{{contactName}} — {{serviceLabel}}', priority: 'medium', href: 'demandes.html' } }],
    },
    {
      id: 'service_request_converted_memory', name: 'Demande convertie',
      trigger: { type: 'service_request_converted', filters: {} }, conditions: [],
      actions: [{ type: 'add_client_memory_entry', config: { category: 'relationship', contentTemplate: 'Client converti depuis une demande publique ({{serviceLabel}}).', visibility: 'internal_team' } }],
    },
  ];

  function normalizeAutomationRule(rule) {
    rule = rule || {};
    if (!rule.id) rule.id = uid();
    rule.name = (rule.name || '').trim() || 'Automatisation sans nom';
    rule.active = !!rule.active;
    rule.trigger = (rule.trigger && typeof rule.trigger === 'object') ? rule.trigger : { type: null, filters: {} };
    if (!rule.trigger.filters || typeof rule.trigger.filters !== 'object') rule.trigger.filters = {};
    rule.conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
    rule.actions = Array.isArray(rule.actions) ? rule.actions : [];
    rule.createdAt = rule.createdAt || new Date().toISOString();
    rule.updatedAt = rule.updatedAt || rule.createdAt;
    rule.lastRunAt = rule.lastRunAt || null;
    rule.runCount = Number.isFinite(rule.runCount) ? rule.runCount : 0;
    return rule;
  }

  function validateAutomationRule(rule) {
    const errors = [];
    if (!rule || !rule.name || !rule.name.trim()) errors.push('Le nom de la règle est requis.');
    if (!rule || !rule.trigger || AUTOMATION_TRIGGER_TYPES.indexOf(rule.trigger.type) === -1) errors.push('Déclencheur invalide.');
    const conditions = (rule && Array.isArray(rule.conditions)) ? rule.conditions : [];
    if (conditions.length > AUTOMATION_MAX_CONDITIONS_PER_RULE) errors.push('Maximum ' + AUTOMATION_MAX_CONDITIONS_PER_RULE + ' conditions par règle.');
    conditions.forEach((c, i) => {
      if (!c || !c.field) errors.push('Condition ' + (i + 1) + ' : champ manquant.');
      if (!c || AUTOMATION_CONDITION_OPERATORS.indexOf(c.operator) === -1) errors.push('Condition ' + (i + 1) + ' : opérateur invalide.');
    });
    const actions = (rule && Array.isArray(rule.actions)) ? rule.actions : [];
    if (actions.length === 0) errors.push('Au moins une action est requise.');
    if (actions.length > AUTOMATION_MAX_ACTIONS_PER_RULE) errors.push('Maximum ' + AUTOMATION_MAX_ACTIONS_PER_RULE + ' actions par règle.');
    actions.forEach((a, i) => {
      if (!a || AUTOMATION_ACTION_TYPES.indexOf(a.type) === -1) errors.push('Action ' + (i + 1) + ' : type invalide.');
    });
    return { valid: errors.length === 0, errors };
  }

  /* field: "event.<clé>" lit event.data[clé] ; "source.<clé>" lit l'objet
     source vivant (état ACTUEL, jamais un snapshot figé dans l'événement)
     via sourceType/sourceId. */
  function resolveAutomationFieldValue(field, event, state) {
    if (!field) return undefined;
    if (field.indexOf('event.') === 0) {
      const key = field.slice(6);
      return event.data ? event.data[key] : undefined;
    }
    if (field.indexOf('source.') === 0) {
      const key = field.slice(7);
      const coll = AUTOMATION_SOURCE_COLLECTION[event.sourceType];
      if (!coll || !state[coll]) return undefined;
      const obj = state[coll].find(x => x.id === event.sourceId);
      return obj ? obj[key] : undefined;
    }
    return undefined;
  }

  function resolveClientIdForEvent(event, state) {
    if (event.sourceType === 'client') return event.sourceId;
    // event.data.clientId : déjà porté par tous les événements existants
    // (quote_sent/invoice_issued/... émettent {clientId,...} dans data),
    // vérifié EN PREMIER donc rétrocompatible. Indispensable pour
    // service_request_created/service_request_converted (source = table
    // dédiée, absente de AUTOMATION_SOURCE_COLLECTION ci-dessous -- sans ce
    // repli, add_client_memory_entry ne résoudrait jamais de client pour
    // ces 2 triggers, même une fois la demande convertie).
    if (event.data && event.data.clientId) return event.data.clientId;
    const coll = AUTOMATION_SOURCE_COLLECTION[event.sourceType];
    if (!coll || !state[coll]) return null;
    const obj = state[coll].find(x => x.id === event.sourceId);
    return obj ? obj.clientId : null;
  }

  function evaluateAutomationConditions(rule, event, state) {
    const conditions = (rule && Array.isArray(rule.conditions)) ? rule.conditions : [];
    return conditions.every(c => {
      const actual = resolveAutomationFieldValue(c.field, event, state);
      switch (c.operator) {
        case 'equals': return actual === c.value;
        case 'not_equals': return actual !== c.value;
        case 'contains': return typeof actual === 'string' && actual.indexOf(c.value) !== -1;
        case 'greater_than': return Number(actual) > Number(c.value);
        case 'less_than': return Number(actual) < Number(c.value);
        case 'is_set': return actual !== undefined && actual !== null && actual !== '';
        case 'is_not_set': return actual === undefined || actual === null || actual === '';
        default: return false;
      }
    });
  }

  /* Résout/valide chaque action SANS écrire -- jamais un SebaDB.create/
     update ici (fonction PURE). L'exécution réelle vit dans
     executeAutomationRule() + SebaDB.automations._runAction(). */
  function planAutomationActions(rule, event, state) {
    const actions = (rule && Array.isArray(rule.actions)) ? rule.actions : [];
    return actions.map(action => {
      if (!action || AUTOMATION_ACTION_TYPES.indexOf(action.type) === -1) {
        return { type: action && action.type, config: action && action.config, valid: false, error: 'Type d\'action inconnu.' };
      }
      if (action.type === 'create_invoice_draft' && event.sourceType !== 'devis' && event.sourceType !== 'intervention') {
        return { type: action.type, config: action.config, valid: false, error: 'Aucun devis/intervention source pour créer une facture.' };
      }
      if (action.type === 'create_follow_up_intervention' && event.sourceType !== 'intervention') {
        return { type: action.type, config: action.config, valid: false, error: 'Source non compatible (intervention attendue).' };
      }
      if (action.type === 'add_client_memory_entry' && !resolveClientIdForEvent(event, state)) {
        return { type: action.type, config: action.config, valid: false, error: 'Aucun client résolu pour cet événement.' };
      }
      if (action.type === 'update_intervention_status') {
        if (event.sourceType !== 'intervention') return { type: action.type, config: action.config, valid: false, error: 'Source non compatible (intervention attendue).' };
        // Même allowlist que la RPC update_my_employee_intervention_status
        // (Intervention 360, migrations/2026-07-23-employee-portal-missions.sql)
        // -- jamais une transition arbitraire, jamais un contournement du
        // modèle existant.
        const allowed = ['en_cours', 'terminee'];
        if (!action.config || allowed.indexOf(action.config.status) === -1) return { type: action.type, config: action.config, valid: false, error: 'Transition de statut non autorisée.' };
      }
      return { type: action.type, config: action.config, valid: true };
    });
  }

  /* Applique le plan -- SEULE fonction (avec processBusinessEvent) qui
     appelle SebaDB.automations._runAction (écriture réelle). continue
     après un échec d'action (jamais interrompu), status final :
     success (tout ok) / partial (mélange) / failed (rien n'a réussi). */
  function executeAutomationRule(rule, event, state) {
    const plan = planAutomationActions(rule, event, state);
    const results = [];
    let anySuccess = false, anyFailure = false;
    plan.forEach(planned => {
      if (!planned.valid) { results.push({ type: planned.type, status: 'failed', error: planned.error }); anyFailure = true; return; }
      let outcome;
      try { outcome = SebaDB.automations._runAction(planned.type, planned.config, event, state, rule); }
      catch (e) { outcome = { ok: false, error: e.message }; }
      if (outcome && outcome.ok) { results.push({ type: planned.type, status: 'success', resultId: outcome.id || null }); anySuccess = true; }
      else { results.push({ type: planned.type, status: 'failed', error: (outcome && outcome.error) || 'Échec inconnu.' }); anyFailure = true; }
    });
    const status = !anyFailure ? 'success' : (anySuccess ? 'partial' : 'failed');
    return { status, results };
  }

  function mkAutomationRun(rule, event, status, errorNote, results) {
    const now = new Date().toISOString();
    return {
      id: uid(), ruleId: rule.id, eventId: event.id, triggerType: event.type,
      sourceType: event.sourceType, sourceId: event.sourceId,
      status, startedAt: now, completedAt: now,
      error: errorNote || null, results: results || [],
    };
  }

  /* Un événement -> toutes les règles ACTIVES dont le trigger correspond.
     Dédoublonnage ruleId+eventId AVANT toute écriture (jamais un double
     traitement, même en cas de rejeu). chainDepth : profondeur de la
     chaîne d'automatisations déclenchées les unes par les autres (section
     8) -- au-delà de AUTOMATION_MAX_CHAIN_DEPTH, un run 'failed' avec
     error='cycle_detected' est journalisé et l'exécution s'arrête
     proprement pour cette règle, jamais un blocage de l'app. */
  function processBusinessEvent(event, state, chainDepth) {
    chainDepth = chainDepth || 0;
    const rules = (state.automationRules || []).filter(r => r.active && r.trigger && r.trigger.type === event.type);
    const runs = [];
    rules.forEach(rule => {
      const already = (state.automationRuns || []).some(r => r.ruleId === rule.id && r.eventId === event.id);
      if (already) return;

      if (chainDepth >= AUTOMATION_MAX_CHAIN_DEPTH) {
        const run = mkAutomationRun(rule, event, 'failed', 'cycle_detected');
        SebaDB.create('automationRuns', run);
        SebaDB.log('automation', 'Cycle détecté, exécution stoppée — ' + rule.name, 'automatisations.html');
        runs.push(run);
        return;
      }

      const conditionsOk = evaluateAutomationConditions(rule, event, state);
      if (!conditionsOk) {
        const run = mkAutomationRun(rule, event, 'skipped', null);
        SebaDB.create('automationRuns', run);
        runs.push(run);
        return;
      }

      const exec = executeAutomationRule(rule, event, state);
      const run = mkAutomationRun(rule, event, exec.status, exec.status === 'failed' ? (exec.results.find(r => r.status === 'failed') || {}).error || null : null, exec.results);
      SebaDB.create('automationRuns', run);
      SebaDB.update('automationRules', rule.id, { runCount: (rule.runCount || 0) + 1, lastRunAt: run.completedAt });
      runs.push(run);
    });
    return runs;
  }

  /* Construit un événement métier -- id STABLE tant que l'appelant
     réutilise le même sourceId+type (voir detectBusinessEvents : le scan
     ne réémet jamais un événement déjà couvert par un automationRun
     existant, donc un rejeu de la même opération ne produit jamais de
     nouvel id ni de nouveau traitement). */
  function emitBusinessEvent(type, payload) {
    payload = payload || {};
    return {
      id: uid(), type, occurredAt: new Date().toISOString(),
      // "account" : non résolu côté client -- ce moteur tourne entièrement
      // à l'intérieur de l'état LOCAL d'UN SEUL compte à la fois (RLS gère
      // déjà l'isolation multi-tenant côté serveur, jamais un second
      // contrôle ici) ; le champ existe pour respecter le modèle canonique
      // demandé, toujours null côté client.
      account: null,
      sourceType: payload.sourceType || null, sourceId: payload.sourceId || null, data: payload.data || {},
    };
  }

  /* Scan de l'état ACTUEL (jamais un recalcul de statut -- simple lecture
     de champs déjà écrits par les écritures métier existantes) : un
     événement est "nouveau" tant qu'AUCUN automationRun n'existe encore
     pour (sourceId, triggerType). Limite connue (V1, documentée) : un
     champ singleton réécrit plusieurs fois dans le temps sur le MÊME
     objet (ex. une 2e demande de report sur la même intervention après
     résolution de la 1re) ne redéclenche pas -- acceptable pour cette
     fondation, pas un bug de sécurité/duplication. */
  function detectBusinessEvents(state) {
    const events = [];
    const hasRun = (sourceId, triggerType) => (state.automationRuns || []).some(r => r.sourceId === sourceId && r.triggerType === triggerType);
    const push = (type, sourceType, sourceId, data) => { if (sourceId && !hasRun(sourceId, type)) events.push(emitBusinessEvent(type, { sourceType, sourceId, data })); };

    (state.clients || []).forEach(c => push('client_created', 'client', c.id, { name: (c.prenom + ' ' + c.nom).trim() }));

    (state.devis || []).forEach(d => {
      if (d.sentAt) push('quote_sent', 'devis', d.id, { clientId: d.clientId, totalTTC: d.totalTTC });
      if (d.status === 'signe') push('quote_accepted', 'devis', d.id, { clientId: d.clientId, totalTTC: d.totalTTC });
      if (d.status === 'refuse') push('quote_rejected', 'devis', d.id, { clientId: d.clientId, comment: d.refusalComment });
    });

    (state.factures || []).forEach(f => {
      if (f.status && f.status !== 'draft') push('invoice_issued', 'facture', f.id, { clientId: f.clientId, totalTTC: SebaDB.factures.total(f) });
      if (SebaDB.factures.isPartial(f)) push('invoice_partially_paid', 'facture', f.id, { clientId: f.clientId, solde: SebaDB.factures.balance(f) });
      if (SebaDB.factures.isPaid(f)) push('invoice_paid', 'facture', f.id, { clientId: f.clientId });
      if (SebaDB.factures.isOverdue(f)) push('invoice_overdue', 'facture', f.id, { clientId: f.clientId, solde: SebaDB.factures.balance(f) });
    });

    (state.interventions || []).forEach(i => {
      push('intervention_created', 'intervention', i.id, { clientId: i.clientId, service: i.service });
      if (i.employeId) push('intervention_assigned', 'intervention', i.id, { employeId: i.employeId, service: i.service });
      const cs = i.execution && i.execution.completionStatus;
      if (cs === 'submitted') push('intervention_completed', 'intervention', i.id, { clientId: i.clientId, service: i.service });
      if (cs === 'owner_approved') push('intervention_owner_approved', 'intervention', i.id, { clientId: i.clientId, service: i.service });
      if (i.rescheduleRequest && i.rescheduleRequest.status === 'pending') push('client_reschedule_requested', 'intervention', i.id, { clientId: i.clientId, requestedDate: i.rescheduleRequest.requestedDate });
      if (i.execution && i.execution.clientApproval && i.execution.clientApproval.status === 'issue_reported') push('client_issue_reported', 'intervention', i.id, { clientId: i.clientId, comment: i.execution.clientApproval.comment });
    });

    (state.employes || []).forEach(e => {
      (e.unavailabilityRequests || []).forEach(r => {
        if (r.status === 'pending') push('employee_unavailability_requested', 'employee', r.id, { employeeId: e.id, startDate: r.startDate, endDate: r.endDate, reason: r.reason });
      });
    });

    return events;
  }

  /* Passe complète : détecte + traite. Chaînage interne borné (jamais via
     un re-déclenchement de SebaDB.onChange, qui boucleraient sans
     limite) -- si les actions de cette passe ont produit de nouveaux
     runs (donc potentiellement de nouveaux faits détectables), une passe
     supplémentaire est tentée, jusqu'à AUTOMATION_MAX_CHAIN_DEPTH. */
  function runAutomationsPass(state, chainDepth) {
    chainDepth = chainDepth || 0;
    if (!state.automationRules || state.automationRules.length === 0) return { events: 0 };
    if (chainDepth > AUTOMATION_MAX_CHAIN_DEPTH) return { events: 0, cycleDetected: true };
    const events = detectBusinessEvents(state);
    if (!events.length) return { events: 0 };
    const before = (state.automationRuns || []).length;
    events.forEach(evt => processBusinessEvent(evt, state, chainDepth));
    const after = (state.automationRuns || []).length;
    if (after > before && chainDepth < AUTOMATION_MAX_CHAIN_DEPTH) return runAutomationsPass(state, chainDepth + 1);
    return { events: events.length };
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

  /* ═══════════════════════════════════════════════════════════════════
     LIENS CANONIQUES + PROCHAINES ACTIONS + TIMELINE (feature/pilot-ready-v1)

     Cette section NE remplace PAS buildClientNextBestActions ci-dessus
     (suggestions relationnelles/CRM -- facture en retard, client inactif,
     etc., scopées au client, déjà mergées et utilisées telles quelles par
     client-fiche.html). getBusinessNextActions ci-dessous répond à une
     question différente et complémentaire : "quel est LE bouton d'action
     du cycle de vie à afficher MAINTENANT sur CETTE fiche (demande/devis/
     intervention/facture/client) ?" -- déterministe, par objet, réutilisé
     par le composant "Prochaine étape" sur plusieurs pages. Les deux
     moteurs coexistent, aucun n'est un doublon de l'autre.

     Liens réutilisés tels quels (jamais renommés) : devis.clientId/
     invoiceId, intervention.clientId/invoiceId, facture.clientId/devisId/
     interventionId (Quote-to-Cash + Intervention 360, déjà mergés).
     Seuls ajouts réels (absents avant ce chantier) : intervention.
     sourceQuoteId (voir SebaDB.interventions.createFromAcceptedQuote) et
     devis.sourceRequestId/intervention.sourceRequestId (demande publique
     d'origine, feature/public-intake-conversion — cette dernière ne
     posait le lien QUE côté intervention jusqu'ici). ═══════════════════ */

  const BUSINESS_OBJECT_COLLECTION = { client: 'clients', devis: 'devis', intervention: 'interventions', facture: 'factures' };

  // Convention de deep-link déjà existante par page, jamais réinventée ici :
  // devis.html attend un NUM (?open=#0125), factures.html attend un ID
  // (?highlight=...), les autres attendent un ID. demandes.html n'avait
  // aucun deep-link avant ce chantier -- ajouté en cohérence avec les autres
  // (?open=<id>, voir demandes.html openFromUrl()).
  const BUSINESS_OBJECT_HREF_BASE = {
    client: 'client-fiche.html?id=', devis: 'devis.html?open=', intervention: 'intervention-fiche.html?id=',
    facture: 'factures.html?highlight=', demande: 'demandes.html?open=',
  };
  function buildBusinessObjectHref(type, id, options) {
    const base = BUSINESS_OBJECT_HREF_BASE[type];
    if (!base || id === null || id === undefined || id === '') return null;
    let href = base + encodeURIComponent(id);
    if (options) {
      if (options.returnTo) href += '&returnTo=' + encodeURIComponent(options.returnTo);
      if (options.focus) href += '&focus=' + encodeURIComponent(options.focus);
      if (options.tab) href += '&tab=' + encodeURIComponent(options.tab);
    }
    return href;
  }

  // contextId peut être un id (résolu dans state) OU l'objet déjà en main
  // (cas des demandes publiques, table dédiée hors seba_state -- voir
  // SebaDB.publicIntake). Jamais un objet copié : uniquement retourné tel
  // quel s'il est déjà fourni.
  function resolveBusinessObject(type, idOrObject, state) {
    if (idOrObject && typeof idOrObject === 'object') return idOrObject;
    const coll = BUSINESS_OBJECT_COLLECTION[type];
    if (!coll || !state || !state[coll]) return null;
    return state[coll].find(x => x.id === idOrObject) || null;
  }
  function businessObjectLabel(type, obj) {
    if (!obj) return null;
    switch (type) {
      case 'client': return fullName(obj) || 'Client';
      case 'devis': return (obj.num || 'Devis') + (obj.service ? ' — ' + obj.service : '');
      case 'intervention': return (obj.service || 'Intervention') + (obj.date ? ' — ' + obj.date : '');
      case 'facture': return (obj.num || 'Facture') + (obj.service ? ' — ' + obj.service : '');
      case 'demande': return obj.contactName || 'Demande';
      default: return null;
    }
  }
  function businessObjectHrefId(type, obj) { return !obj ? null : (type === 'devis' ? obj.num : obj.id); }
  function linkEntry(type, idOrObject, state, options) {
    const obj = resolveBusinessObject(type, idOrObject, state);
    if (!obj) return null;
    return { type, id: obj.id, label: businessObjectLabel(type, obj), href: buildBusinessObjectHref(type, businessObjectHrefId(type, obj), options) };
  }

  /* Relations RÉELLEMENT connues d'un objet métier -- jamais l'objet source
     copié, uniquement les références déjà posées. */
  function getLinkedBusinessObjects(contextType, contextId, state) {
    const relations = {};
    if (contextType === 'demande') {
      const req = resolveBusinessObject('demande', contextId, state);
      if (!req) return relations;
      if (req.convertedClientId) relations.client = linkEntry('client', req.convertedClientId, state);
      if (req.convertedQuoteId) {
        const d = (state.devis || []).find(x => x.num === req.convertedQuoteId);
        if (d) relations.devis = linkEntry('devis', d, state);
      }
      if (req.convertedInterventionId) relations.intervention = linkEntry('intervention', req.convertedInterventionId, state);
      return relations;
    }

    const obj = resolveBusinessObject(contextType, contextId, state);
    if (!obj) return relations;

    if (contextType === 'devis') {
      if (obj.clientId) relations.client = linkEntry('client', obj.clientId, state);
      if (obj.invoiceId) relations.facture = linkEntry('facture', obj.invoiceId, state);
      const interv = (state.interventions || []).find(i => i.sourceQuoteId === obj.id);
      if (interv) relations.intervention = linkEntry('intervention', interv, state);
    } else if (contextType === 'intervention') {
      if (obj.clientId) relations.client = linkEntry('client', obj.clientId, state);
      if (obj.invoiceId) relations.facture = linkEntry('facture', obj.invoiceId, state);
      if (obj.sourceQuoteId) relations.devis = linkEntry('devis', obj.sourceQuoteId, state);
    } else if (contextType === 'facture') {
      if (obj.clientId) relations.client = linkEntry('client', obj.clientId, state);
      if (obj.devisId) relations.devis = linkEntry('devis', obj.devisId, state);
      if (obj.interventionId) relations.intervention = linkEntry('intervention', obj.interventionId, state);
    } else if (contextType === 'client') {
      relations.devis = (state.devis || []).filter(d => d.clientId === obj.id).map(d => linkEntry('devis', d, state));
      relations.interventions = (state.interventions || []).filter(i => i.clientId === obj.id).map(i => linkEntry('intervention', i, state));
      relations.factures = (state.factures || []).filter(f => f.clientId === obj.id).map(f => linkEntry('facture', f, state));
    }
    return relations;
  }

  /* Conversion déjà existante entre une source et un type cible -- unique
     mécanisme d'idempotence réutilisé par SebaDB.interventions.
     createFromAcceptedQuote (voir plus bas) et exposé pour tout futur appelant. */
  function findExistingConversion(sourceType, sourceId, targetType, state) {
    if (sourceType === 'devis' && targetType === 'intervention') {
      const src = (state.devis || []).find(d => d.id === sourceId);
      if (src && src.interventionId) {
        const existing = (state.interventions || []).find(i => i.id === src.interventionId);
        if (existing) return existing;
      }
      return (state.interventions || []).find(i => i.sourceQuoteId === sourceId) || null;
    }
    if (sourceType === 'devis' && targetType === 'facture') {
      const src = (state.devis || []).find(d => d.id === sourceId);
      return src && src.invoiceId ? (state.factures || []).find(f => f.id === src.invoiceId) || null : null;
    }
    if (sourceType === 'intervention' && targetType === 'facture') {
      const src = (state.interventions || []).find(i => i.id === sourceId);
      return src && src.invoiceId ? (state.factures || []).find(f => f.id === src.invoiceId) || null : null;
    }
    return null;
  }

  /* Moteur pur des prochaines actions -- aucune écriture, aucune lecture
     réseau, résultat déterministe. Ne calcule QUE pour le patron (role
     owner/patron) : les portails client/employé gardent leurs propres
     flux dédiés déjà complets (client-espace.html/espace-terrain.html),
     jamais dupliqués ici. `command` est un identifiant que CHAQUE page
     appelante mappe vers son propre handler réel (ce fichier n'a aucun
     accès DOM) ; `href` est déjà construit via buildBusinessObjectHref. */
  function trimNextActions(actions) {
    const primary = actions.filter(a => a.priority === 'primary').slice(0, 1);
    const secondary = actions.filter(a => a.priority === 'secondary').slice(0, 2);
    return primary.concat(secondary);
  }
  function getBusinessNextActions(contextType, contextId, state, actorContext) {
    actorContext = actorContext || {};
    if (actorContext.role && actorContext.role !== 'owner' && actorContext.role !== 'patron') return [];
    const obj = resolveBusinessObject(contextType, contextId, state);
    if (!obj) return [];
    const actions = [];
    const add = (id, label, priority, kind, extra) => {
      actions.push(Object.assign({ id, label, description: '', priority, kind, href: null, command: null, sourceType: contextType, sourceId: obj.id }, extra || {}));
    };

    if (contextType === 'demande') {
      if (obj.status === 'new' || obj.status === 'qualified' || obj.status === 'contacted') {
        add('convert-client', 'Créer le client', 'primary', 'command', { command: 'convertPublicRequest:client', description: 'Créer la fiche client sans ressaisie.' });
        add('convert-client-devis', 'Créer le client + devis', 'secondary', 'command', { command: 'convertPublicRequest:client_quote' });
        add('convert-client-intervention', 'Créer le client + intervention', 'secondary', 'command', { command: 'convertPublicRequest:client_intervention' });
      } else if (obj.status === 'converted') {
        if (obj.convertedClientId) add('open-client', 'Ouvrir le client', 'primary', 'navigate', { href: buildBusinessObjectHref('client', obj.convertedClientId) });
        if (obj.convertedQuoteId) add('open-devis', 'Ouvrir le devis', 'secondary', 'navigate', { href: buildBusinessObjectHref('devis', obj.convertedQuoteId) });
        if (obj.convertedInterventionId) add('open-intervention', 'Ouvrir l\'intervention', 'secondary', 'navigate', { href: buildBusinessObjectHref('intervention', obj.convertedInterventionId) });
      }
      return trimNextActions(actions);
    }

    if (contextType === 'devis') {
      if (obj.status === 'brouillon') {
        add('edit-devis', 'Modifier le devis', 'primary', 'navigate', { href: 'devis-nouveau.html?id=' + encodeURIComponent(obj.id) });
        add('send-devis', 'Envoyer le devis', 'secondary', 'command', { command: 'sendDevis' });
      } else if (obj.status === 'attente') {
        add('open-client', 'Ouvrir la fiche client', 'primary', 'navigate', { href: buildBusinessObjectHref('client', obj.clientId) });
      } else if (obj.status === 'signe') {
        if (!obj.interventionId) add('create-intervention', 'Créer l\'intervention', 'primary', 'command', { command: 'createInterventionFromAcceptedQuote' });
        else add('open-intervention', 'Ouvrir l\'intervention', 'primary', 'navigate', { href: buildBusinessObjectHref('intervention', obj.interventionId) });
        if (!obj.invoiceId) add('create-invoice', 'Créer la facture', 'secondary', 'command', { command: 'createFromDevis' });
      } else if (obj.status === 'refuse' || obj.status === 'annule') {
        add('duplicate-devis', 'Dupliquer le devis', 'secondary', 'command', { command: 'duplicateDevis' });
      }
      return trimNextActions(actions);
    }

    if (contextType === 'intervention') {
      normalizeIntervention(obj);
      const cs = obj.execution.completionStatus;
      if (!obj.date) add('plan', 'Planifier', 'primary', 'navigate', { href: 'planning.html' });
      else if (!obj.employeId) {
        add('suggest-employee', 'Suggérer un employé', 'primary', 'command', { command: 'suggestEmployee' });
        add('choose-employee', 'Choisir un employé', 'secondary', 'navigate', { href: 'planning.html' });
      } else if (cs === 'in_progress' || cs === 'paused') {
        add('follow-execution', 'Suivre l\'exécution', 'primary', 'navigate', { href: buildBusinessObjectHref('intervention', obj.id) });
      } else if (cs === 'submitted') {
        add('owner-approve', 'Valider l\'intervention', 'primary', 'command', { command: 'ownerApproveIntervention' });
      } else if (cs === 'owner_approved') {
        if (!obj.invoiceId) add('create-invoice', 'Créer la facture', 'primary', 'command', { command: 'createInvoiceFromIntervention' });
        else add('open-invoice', 'Ouvrir la facture', 'primary', 'navigate', { href: buildBusinessObjectHref('facture', obj.invoiceId) });
      } else if (cs === 'not_started') {
        add('open-planning', 'Ouvrir dans le planning', 'secondary', 'navigate', { href: 'planning.html' });
      }
      return trimNextActions(actions);
    }

    if (contextType === 'facture') {
      if (SebaDB.factures.isDraft(obj)) add('complete-invoice', 'Compléter ou émettre', 'primary', 'command', { command: 'completeInvoice' });
      else if (SebaDB.factures.isPartial(obj)) add('record-payment', 'Enregistrer le solde', 'primary', 'command', { command: 'recordPayment' });
      else if (SebaDB.factures.isPaid(obj)) add('open-history', 'Ouvrir l\'historique client', 'primary', 'navigate', { href: buildBusinessObjectHref('client', obj.clientId) });
      else if (!SebaDB.factures.isCancelled(obj)) add('record-payment', 'Enregistrer un paiement', 'primary', 'command', { command: 'recordPayment' });
      return trimNextActions(actions);
    }

    if (contextType === 'client') {
      const openDevis = (state.devis || []).find(d => d.clientId === obj.id && d.status === 'attente');
      const openInterv = (state.interventions || []).find(i => i.clientId === obj.id && !i.done && (!i.execution || i.execution.completionStatus !== 'owner_approved'));
      if (openDevis) add('open-devis', 'Ouvrir le devis en attente', 'primary', 'navigate', { href: buildBusinessObjectHref('devis', openDevis.num) });
      else if (openInterv) add('open-intervention', 'Ouvrir l\'intervention en cours', 'primary', 'navigate', { href: buildBusinessObjectHref('intervention', openInterv.id) });
      else {
        add('new-devis', 'Créer un devis', 'primary', 'navigate', { href: 'devis-nouveau.html?clientId=' + encodeURIComponent(obj.id) });
        add('new-intervention', 'Créer une intervention', 'secondary', 'navigate', { href: 'planning.html' });
      }
      return trimNextActions(actions);
    }

    return [];
  }

  /* Timeline dérivée -- jamais une table d'événements séparée, jamais une
     copie dans le client : calcul PUR sur devis/interventions/factures déjà
     en state à chaque appel. publicRequests (optionnel) : demandes déjà
     récupérées par l'appelant (table dédiée hors seba_state, voir
     SebaDB.publicIntake.list()) et pré-filtrées sur ce client -- cette
     fonction reste pure (zéro lecture réseau elle-même), c'est l'appelant
     qui fait l'aller-retour avant de l'appeler. */
  const TIMELINE_EVENT_ORDER = [
    'demande_recue', 'demande_qualifiee', 'demande_convertie',
    'devis_cree', 'devis_envoye', 'devis_accepte', 'devis_refuse',
    'intervention_creee', 'intervention_planifiee', 'employe_assigne',
    'intervention_demarree', 'pause', 'reprise', 'intervention_terminee',
    'approbation_client', 'validation_patron', 'incident_declare', 'demande_report',
    'facture_creee', 'paiement_enregistre', 'facture_soldee',
  ];
  function buildClientOperationalTimeline(clientId, state, publicRequests) {
    const events = [];
    const push = (type, occurredAt, title, description, sourceType, sourceObjOrId, visibility) => {
      if (!occurredAt) return; // jamais une date inventée (pas de Date.now()) -- source manquante = événement omis
      const srcId = sourceObjOrId && typeof sourceObjOrId === 'object' ? sourceObjOrId.id : sourceObjOrId;
      const hrefId = sourceObjOrId && typeof sourceObjOrId === 'object' ? businessObjectHrefId(sourceType, sourceObjOrId) : sourceObjOrId;
      events.push({
        id: type + ':' + sourceType + ':' + srcId + ':' + occurredAt,
        type, occurredAt, title, description: description || '',
        sourceType, sourceId: srcId, href: buildBusinessObjectHref(sourceType, hrefId),
        visibility: visibility || 'owner',
      });
    };

    (publicRequests || []).forEach(r => {
      if (r.convertedClientId !== clientId) return;
      push('demande_recue', r.createdAt, 'Demande reçue', r.serviceLabel || '', 'demande', r.id, 'owner');
      if (r.status === 'qualified') push('demande_qualifiee', r.updatedAt, 'Demande qualifiée', '', 'demande', r.id, 'owner');
      if (r.convertedAt) push('demande_convertie', r.convertedAt, 'Demande convertie', '', 'demande', r.id, 'owner');
    });

    (state.devis || []).filter(d => d.clientId === clientId).forEach(d => {
      push('devis_cree', d.date, 'Devis créé', d.num || '', 'devis', d, 'owner');
      if (d.sentAt) push('devis_envoye', d.sentAt, 'Devis envoyé', d.num || '', 'devis', d, 'client');
      if (d.acceptedAt) push('devis_accepte', d.acceptedAt, 'Devis accepté', d.num || '', 'devis', d, 'client');
      if (d.refusedAt) push('devis_refuse', d.refusedAt, 'Devis refusé', d.refusalComment || '', 'devis', d, 'client');
    });

    const INTERVENTION_HISTORY_MAP = {
      assigned: ['employe_assigne', 'Employé assigné', 'internal'],
      started: ['intervention_demarree', 'Intervention démarrée', 'internal'],
      paused: ['pause', 'Pause', 'internal'],
      resumed: ['reprise', 'Reprise', 'internal'],
      completed: ['intervention_terminee', 'Intervention terminée', 'client'],
      client_approved: ['approbation_client', 'Approbation client', 'client'],
      owner_approved: ['validation_patron', 'Validation patron', 'owner'],
      incident_reported: ['incident_declare', 'Incident déclaré', 'internal'],
      reschedule_request_accepted: ['demande_report', 'Report accepté', 'client'],
    };
    (state.interventions || []).filter(i => i.clientId === clientId).forEach(i => {
      normalizeIntervention(i);
      push('intervention_creee', i.createdAt, 'Intervention créée', i.service || '', 'intervention', i, 'owner');
      if (i.date) push('intervention_planifiee', i.date, 'Intervention planifiée', i.service || '', 'intervention', i, 'client');
      (i.statusHistory || []).forEach(ev => {
        const m = INTERVENTION_HISTORY_MAP[ev.event];
        if (m) push(m[0], ev.createdAt, m[1], '', 'intervention', i, m[2]);
      });
      if (i.rescheduleRequest && i.rescheduleRequest.requestedAt) push('demande_report', i.rescheduleRequest.requestedAt, 'Demande de report', i.rescheduleRequest.comment || '', 'intervention', i, 'client');
    });

    (state.factures || []).filter(f => f.clientId === clientId).forEach(f => {
      push('facture_creee', f.date, 'Facture créée', f.num || '', 'facture', f, 'owner');
      (f.statusHistory || []).forEach(ev => {
        if (ev.event === 'payment_recorded') push('paiement_enregistre', ev.createdAt, 'Paiement enregistré', (ev.metadata && ev.metadata.amount) ? ev.metadata.amount + ' €' : '', 'facture', f, 'client');
      });
      if (SebaDB.factures.isPaid(f) && f.paidAt) push('facture_soldee', f.paidAt, 'Facture soldée', f.num || '', 'facture', f, 'client');
    });

    const typeRank = (t) => { const idx = TIMELINE_EVENT_ORDER.indexOf(t); return idx === -1 ? 999 : idx; };
    events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || (typeRank(a.type) - typeRank(b.type)) || a.id.localeCompare(b.id));

    const seen = new Set();
    return events.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
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
  // Arrondi monétaire — évite les résidus flottants (0.1+0.2) sur des
  // totaux affichés/persistés (quote-to-cash, feature/quote-to-cash).
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /* ── Argent en centimes entiers (feature/flexible-commercial-documents) --
     tout calcul financier CRITIQUE (lignes/remises/TVA/acompte) passe par
     ici, jamais une comparaison flottante. toCents/fromCents restent la
     seule frontière de conversion euros<->centimes. ── */
  function toCents(v) { return Math.round((Number(v) || 0) * 100); }
  function fromCents(c) { return round2((Number(c) || 0) / 100); }

  /* Numérotation configurable (préfixe/année/longueur du compteur) --
     formate un compteur déjà incrémenté par SebaDB.nextNum(), ne décide
     jamais elle-même de la valeur du compteur. */
  const DEFAULT_DOCUMENT_NUMBERING = {
    devis: { prefix: 'DEV', showYear: true, counterLength: 4 },
    facture: { prefix: 'FAC', showYear: true, counterLength: 4 },
    recu: { prefix: 'REC', showYear: true, counterLength: 4 },
  };
  /* Préférences d'affichage par défaut (section 19) -- toutes activées par
     défaut sauf showSignatureArea (fonctionnalité non développée dans ce
     chantier, jamais affichée tant qu'aucune signature électronique
     n'existe réellement). */
  const DEFAULT_DOCUMENT_DISPLAY_PREFS = {
    showLogo: true, showCompanyAddress: true, showCompanyPhone: true, showCompanyEmail: true,
    showBankDetails: false, showUnitPrices: true, showTaxColumn: true, showDiscountDetails: true,
    showPaymentHistory: true, showAcceptanceDetails: true, showSignatureArea: false,
    showServiceAddress: true, showClientReference: true,
  };
  function formatDocumentNumber(counter, cfg) {
    const parts = [];
    if (cfg && cfg.prefix) parts.push(String(cfg.prefix).trim());
    if (cfg && cfg.showYear) parts.push(String(new Date().getFullYear()));
    parts.push(String(counter).padStart((cfg && cfg.counterLength) || 4, '0'));
    return parts.join('-');
  }

  /* ═══════════════════════════════════════════════════════════════════
     ESPACE COMMERCIAL FLEXIBLE (feature/flexible-commercial-documents)

     Calcul centralisé, une seule politique d'arrondi, jamais une logique
     différente entre formulaire/aperçu/document/portail/reçu -- toute
     page appelle buildCommercialDocumentTotals(). N'ALTÈRE PAS
     SebaDB.devis.computeTotals() (Quote-to-Cash existant, jamais réécrit) :
     les VIEUX devis simples (une seule ligne {desc,qty,u}, un seul
     tvaRate document) produisent des totaux STRICTEMENT identiques via
     l'un ou l'autre moteur (vérifié en QA) -- ce nouveau moteur est un
     SURENSEMBLE (remise par ligne, TVA par ligne, remise globale, acompte
     centimes), jamais une divergence pour les cas déjà couverts. ═══════ */

  const COMMERCIAL_LINE_TYPES = ['service', 'product', 'time', 'travel', 'material', 'fee', 'free'];
  // Le type ne change JAMAIS le calcul (section 5 du chantier) -- purement
  // indicatif pour la saisie/l'affichage.
  const COMMERCIAL_LINE_UNITS = ['forfait', 'heure', 'jour', 'intervention', 'piece', 'unite', 'm2', 'metre', 'kilometre', 'mois', 'aucune'];

  function normalizeCommercialLine(line) {
    line = line || {};
    // Compat lignes historiques Quote-to-Cash ({id,desc,qty,u}) : mappées
    // sans perte vers le modèle enrichi, jamais un recalcul divergent.
    const quantity = Number.isFinite(line.quantity) ? Number(line.quantity) : (Number(line.qty) || 0);
    const unitPriceCents = Number.isFinite(line.unitPriceCents) ? line.unitPriceCents : toCents(line.u != null ? line.u : line.unitPrice);
    return {
      id: line.id || uid(),
      // 'section' (titre de présentation, section 6) n'est pas l'un des 7
      // types facturables (section 5) -- préservé explicitement AVANT le
      // repli 'free', sinon isSectionLine() ne matcherait plus jamais
      // rien après normalisation.
      type: line.type === 'section' ? 'section' : (COMMERCIAL_LINE_TYPES.indexOf(line.type) !== -1 ? line.type : 'free'),
      serviceId: line.serviceId || null,
      description: line.description || line.desc || '',
      details: line.details || '',
      quantity, unit: line.unit || '',
      unitPriceCents,
      discountType: line.discountType === 'percent' || line.discountType === 'amount' ? line.discountType : null,
      discountValue: Number(line.discountValue) || 0,
      taxRate: Number.isFinite(line.taxRate) ? Number(line.taxRate) : null, // null = utilise le taux document (rétrocompat)
      position: Number.isFinite(line.position) ? line.position : 0,
      // Alias rétrocompat (feature/flexible-commercial-documents, éditeurs) --
      // desc/qty/u : lus par du code plus ancien qui n'a jamais été migré vers
      // description/quantity/unitPriceCents (ex. client-espace.html
      // renderDevisLinesHtml, devis.html buildReceipt). Dérivés, jamais une
      // seconde source de vérité : recalculés à chaque normalisation.
      desc: line.description || line.desc || '',
      qty: quantity,
      u: fromCents(unitPriceCents),
    };
  }

  /* Une ligne "section" (titre de présentation, section 6) n'a pas de
     prix -- reconnue par type:'section', jamais mélangée aux lignes
     facturables dans les totaux. */
  function isSectionLine(line) { return line && line.type === 'section'; }

  function computeCommercialLineTotals(line, documentTaxRate) {
    const qty = Number(line.quantity) || 0;
    const grossCents = Math.round(qty * (Number(line.unitPriceCents) || 0));
    let discountCents = 0;
    if (line.discountType === 'percent' && line.discountValue > 0) {
      discountCents = Math.round(grossCents * (Math.min(100, line.discountValue) / 100));
    } else if (line.discountType === 'amount' && line.discountValue > 0) {
      discountCents = Math.min(grossCents, toCents(line.discountValue));
    }
    const totalExcludingTaxCents = Math.max(0, grossCents - discountCents);
    const taxRate = line.taxRate != null ? line.taxRate : (Number(documentTaxRate) || 0);
    const taxAmountCents = Math.round(totalExcludingTaxCents * (taxRate / 100));
    const totalIncludingTaxCents = totalExcludingTaxCents + taxAmountCents;
    return Object.assign({}, line, { grossCents, discountCents, totalExcludingTaxCents, taxRate, taxAmountCents, totalIncludingTaxCents });
  }

  /* options : { documentTaxRate, discountType, discountValue (remise
     globale), depositType, depositValue }. Retourne aussi byRate (section
     8 : récapitulatif par taux) et le détail par ligne (jamais recalculé
     ailleurs -- l'appelant affiche ces valeurs telles quelles). */
  function buildCommercialDocumentTotals(lines, options) {
    options = options || {};
    const normalized = (Array.isArray(lines) ? lines : []).map(normalizeCommercialLine);
    const billable = normalized.filter(l => !isSectionLine(l)).map(l => computeCommercialLineTotals(l, options.documentTaxRate));
    const sections = normalized.filter(isSectionLine);

    const subtotalExclCents = billable.reduce((s, l) => s + l.totalExcludingTaxCents, 0);
    let globalDiscountCents = 0;
    if (options.discountType === 'percent' && Number(options.discountValue) > 0) {
      globalDiscountCents = Math.round(subtotalExclCents * (Math.min(100, Number(options.discountValue)) / 100));
    } else if (options.discountType === 'amount' && Number(options.discountValue) > 0) {
      globalDiscountCents = Math.min(subtotalExclCents, toCents(options.discountValue));
    }
    const totalExclCents = Math.max(0, subtotalExclCents - globalDiscountCents);

    // Répartition de la remise globale au prorata de chaque taux (jamais un
    // seul taux appliqué à l'ensemble quand plusieurs taux coexistent).
    const byRateMap = {};
    billable.forEach(l => {
      const key = String(l.taxRate);
      if (!byRateMap[key]) byRateMap[key] = { rate: l.taxRate, exclCents: 0 };
      byRateMap[key].exclCents += l.totalExcludingTaxCents;
    });
    let totalTaxCents = 0;
    const byRate = Object.keys(byRateMap).map(key => {
      const grp = byRateMap[key];
      const share = subtotalExclCents > 0 ? grp.exclCents / subtotalExclCents : 0;
      const grpDiscountCents = Math.round(globalDiscountCents * share);
      const exclAfterDiscountCents = Math.max(0, grp.exclCents - grpDiscountCents);
      const taxCents = Math.round(exclAfterDiscountCents * (Number(grp.rate) / 100));
      totalTaxCents += taxCents;
      return { rate: grp.rate, exclCents: exclAfterDiscountCents, taxCents };
    }).sort((a, b) => a.rate - b.rate);

    const totalInclCents = totalExclCents + totalTaxCents;

    let depositCents = 0;
    if (options.depositType === 'percent' && Number(options.depositValue) > 0) {
      depositCents = Math.round(totalInclCents * (Math.min(100, Number(options.depositValue)) / 100));
    } else if (options.depositType === 'amount' && Number(options.depositValue) > 0) {
      depositCents = Math.min(totalInclCents, toCents(options.depositValue));
    }
    const balanceAfterDepositCents = Math.max(0, totalInclCents - depositCents);

    return {
      lines: billable, sections,
      subtotalExclCents, globalDiscountCents, totalExclCents,
      byRate, totalTaxCents, totalInclCents,
      depositCents, balanceAfterDepositCents,
      // Alias euros pour l'affichage direct (jamais utilisés pour un calcul ultérieur).
      totalHT: fromCents(totalExclCents), totalTVA: fromCents(totalTaxCents), totalTTC: fromCents(totalInclCents),
      depositAmount: fromCents(depositCents), balanceAfterDeposit: fromCents(balanceAfterDepositCents),
    };
  }

  /* Snapshot documentaire (section 12) -- posé UNE SEULE FOIS au premier
     envoi/émission, jamais recalculé ensuite : un changement ultérieur de
     la fiche client/de l'entreprise ne doit JAMAIS modifier un document
     déjà émis. N'écrit rien dans une nouvelle table (stocké tel quel dans
     le champ documentSnapshot du devis/de la facture existants). */
  function buildDocumentSnapshot(type, payload, state) {
    const client = (state.clients || []).find(c => c.id === payload.clientId);
    const entreprise = state.entreprise || {};
    const totalsRich = buildCommercialDocumentTotals(payload.lines, {
      documentTaxRate: payload.tvaRate,
      discountType: payload.remise ? payload.remise.type : null, discountValue: payload.remise ? payload.remise.value : 0,
      depositType: payload.acompte ? payload.acompte.type : null, depositValue: payload.acompte ? payload.acompte.value : 0,
    });
    return {
      generatedAt: new Date().toISOString(),
      company: { nom: entreprise.nom || '', email: entreprise.email || '', telephone: entreprise.telephone || '', zone: entreprise.zone || '' },
      customer: client
        ? { prenom: client.prenom || '', nom: client.nom || '', contact: client.contact || '', email: client.email || '', adresse: client.adresse || '' }
        : { prenom: '', nom: payload.clientName || '', contact: '', email: '', adresse: '' },
      // Adresse de facturation/prestation : surcharge propre au document si
      // fournie (section 11 -- "jamais écraser automatiquement la fiche
      // client"), repli sur l'adresse de la fiche sinon.
      billingAddress: payload.billingAddress || (client && client.adresse) || '',
      serviceAddress: payload.serviceAddress || (client && client.adresse) || '',
      clientReference: payload.clientReference || '', // client-safe (affiché au client)
      lines: totalsRich.lines.concat(totalsRich.sections),
      totals: {
        subtotalExclCents: totalsRich.subtotalExclCents, globalDiscountCents: totalsRich.globalDiscountCents,
        totalExclCents: totalsRich.totalExclCents, byRate: totalsRich.byRate, totalTaxCents: totalsRich.totalTaxCents,
        totalInclCents: totalsRich.totalInclCents, depositCents: totalsRich.depositCents, balanceAfterDepositCents: totalsRich.balanceAfterDepositCents,
      },
      currency: 'EUR',
      // JAMAIS payload.notes ici : note interne patron (voir SebaDB.devis._buildPayload,
      // "jamais envoyé au client") -- le snapshot est exposé au client via
      // get_my_client_devis_detail/get_my_client_facture_detail (allowlist
      // migrations/2026-07-27-flexible-commercial-documents.sql), donc tout
      // champ posé ici doit déjà être client-safe. Seul `conditions` l'est.
      terms: { conditions: payload.conditions || '', validityDate: payload.validityDate || null },
      // Fusion préférences globales + surcharge propre à CE document
      // (section 19) -- figée ici définitivement, jamais réévaluée après
      // l'envoi même si les préférences globales changent ensuite.
      documentOptions: mergeDisplayOptions(state, payload.documentOptions),
    };
  }

  /* Modèles documentaires purs (section 21) -- aucune écriture, aucun
     réseau, aucun DOM. Utilisent le snapshot quand il existe (document déjà
     envoyé/émis, historiquement figé), sinon recalculent en LIVE depuis
     l'état actuel (brouillon, ou vieil objet sans snapshot -- fallback
     rétrocompatible explicite). objOrId peut être l'objet déjà en main
     (portail client, allowlist RPC) ou un id à résoudre dans state
     (patron, accès complet). */
  /* Préférences d'affichage PAR DOCUMENT (section 19) -- un devis/une
     facture peut surcharger certaines clés des préférences globales
     (state.documentDisplayPrefs), la surcharge ne s'appliquant JAMAIS aux
     autres documents. docOverride : objet partiel (uniquement les clés
     réellement surchargées), jamais l'objet complet. */
  function mergeDisplayOptions(state, docOverride) {
    return Object.assign({}, DEFAULT_DOCUMENT_DISPLAY_PREFS, (state && state.documentDisplayPrefs) || {}, docOverride || {});
  }

  function buildQuoteDocumentModel(quoteObjOrId, state, actorContext) {
    state = state || {};
    const d = (quoteObjOrId && typeof quoteObjOrId === 'object') ? quoteObjOrId : resolveBusinessObject('devis', quoteObjOrId, state);
    if (!d) return null;
    const snap = d.documentSnapshot || null;
    const client = (state.clients || []).find(c => c.id === d.clientId) || null;
    const totals = snap ? snap.totals : buildCommercialDocumentTotals(d.lines, {
      documentTaxRate: d.tvaRate, discountType: d.remise && d.remise.type, discountValue: d.remise && d.remise.value,
      depositType: d.acompte && d.acompte.type, depositValue: d.acompte && d.acompte.value,
    });
    const allLines = snap ? snap.lines : buildCommercialDocumentTotals(d.lines, { documentTaxRate: d.tvaRate }).lines.concat([]);
    return {
      documentType: 'devis', documentNumber: d.status === 'brouillon' ? null : (d.num || null), revisionNumber: d.revisionNumber || 1,
      issueDate: d.sentAt || d.date || null, dueDate: null, validityDate: d.validityDate || null,
      status: d.status, currency: 'EUR',
      company: (snap && snap.company) || state.entreprise || {},
      customer: (snap && snap.customer) || (client
        ? { prenom: client.prenom || '', nom: client.nom || '', contact: client.contact || '', email: client.email || '', adresse: client.adresse || '' }
        : { prenom: '', nom: d.clientName || '', contact: '', email: '', adresse: '' }),
      billingAddress: (snap && snap.billingAddress) || d.billingAddress || (client && client.adresse) || '',
      serviceAddress: (snap && snap.serviceAddress) || d.serviceAddress || (client && client.adresse) || '',
      clientReference: (snap && snap.clientReference) || d.clientReference || '',
      lines: allLines.filter(l => !isSectionLine(l)), sections: allLines.filter(isSectionLine),
      totals,
      references: {
        parentQuoteId: d.parentQuoteId || null, supersededByQuoteId: d.supersededByQuoteId || null,
        sourceRequestId: d.sourceRequestId || null, sourceInterventionId: d.sourceInterventionId || null, invoiceId: d.invoiceId || null,
      },
      notes: (snap && snap.terms && snap.terms.notes) || '',
      terms: { conditions: (snap && snap.terms && snap.terms.conditions) || d.conditions || '' },
      options: (snap && snap.documentOptions) || mergeDisplayOptions(state, d.documentOptions),
      acceptance: { acceptedAt: d.acceptedAt || null, acceptedBy: d.acceptedBy || null, refusedAt: d.refusedAt || null, refusalComment: d.refusalComment || null },
      payments: [],
      snapshotSource: snap ? 'snapshot' : 'live',
    };
  }

  function buildInvoiceDocumentModel(invoiceObjOrId, state, actorContext) {
    state = state || {};
    const f = (invoiceObjOrId && typeof invoiceObjOrId === 'object') ? invoiceObjOrId : resolveBusinessObject('facture', invoiceObjOrId, state);
    if (!f) return null;
    const snap = f.documentSnapshot || null;
    const client = (state.clients || []).find(c => c.id === f.clientId) || null;
    const totals = snap ? snap.totals : buildCommercialDocumentTotals(f.lines, {
      documentTaxRate: f.tvaRate, discountType: f.remise && f.remise.type, discountValue: f.remise && f.remise.value,
    });
    const allLines = snap ? snap.lines : buildCommercialDocumentTotals(f.lines, { documentTaxRate: f.tvaRate }).lines.concat([]);
    const payments = (f.payments || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '') || String(a.id).localeCompare(String(b.id)));
    return {
      documentType: 'facture', documentNumber: f.status === 'draft' ? null : (f.num || null), revisionNumber: 1,
      issueDate: f.date || null, dueDate: f.dueDate || null, validityDate: null,
      status: f.status, currency: 'EUR',
      company: (snap && snap.company) || state.entreprise || {},
      customer: (snap && snap.customer) || (client
        ? { prenom: client.prenom || '', nom: client.nom || '', contact: client.contact || '', email: client.email || '', adresse: client.adresse || '' }
        : { prenom: '', nom: f.clientName || '', contact: '', email: '', adresse: '' }),
      billingAddress: (snap && snap.billingAddress) || f.billingAddress || (client && client.adresse) || '',
      serviceAddress: (snap && snap.serviceAddress) || f.serviceAddress || (client && client.adresse) || '',
      clientReference: (snap && snap.clientReference) || f.clientReference || '',
      lines: allLines.filter(l => !isSectionLine(l)), sections: allLines.filter(isSectionLine),
      totals,
      references: { devisId: f.devisId || null, interventionId: f.interventionId || null },
      notes: (snap && snap.terms && snap.terms.notes) || '',
      terms: { conditions: (snap && snap.terms && snap.terms.conditions) || f.conditions || '' },
      options: (snap && snap.documentOptions) || mergeDisplayOptions(state, f.documentOptions),
      acceptance: null,
      payments: payments.map(p => ({ id: p.id, amount: p.amount, mode: p.mode, date: p.date, reference: p.reference, createdAt: p.createdAt })),
      montantPaye: (window.SebaDB ? SebaDB.factures.paidAmount(f) : payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
      solde: (window.SebaDB ? SebaDB.factures.balance(f) : null),
      snapshotSource: snap ? 'snapshot' : 'live',
    };
  }

  /* Le reçu correspond à UN paiement réellement enregistré (jamais un
     acompte simplement demandé, jamais une promesse -- section 24).
     Le solde après paiement utilise l'ORDRE RÉEL des paiements (date puis
     createdAt puis id, jamais uniquement le solde actuel de la facture si
     des paiements ultérieurs existent). */
  function buildReceiptDocumentModel(invoiceObjOrId, paymentId, state, actorContext) {
    state = state || {};
    const f = (invoiceObjOrId && typeof invoiceObjOrId === 'object') ? invoiceObjOrId : resolveBusinessObject('facture', invoiceObjOrId, state);
    if (!f) return null;
    const payments = (f.payments || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '') || String(a.id).localeCompare(String(b.id)));
    const idx = payments.findIndex(p => p.id === paymentId);
    if (idx === -1) return null; // jamais de reçu pour un paiement inexistant
    const payment = payments[idx];
    const cumulativeCents = payments.slice(0, idx + 1).reduce((s, p) => s + toCents(p.amount), 0);
    const invoiceModel = buildInvoiceDocumentModel(f, state, actorContext);
    const totalCents = invoiceModel.totals.totalInclCents;
    return {
      documentType: 'recu', documentNumber: null, revisionNumber: 1,
      issueDate: payment.date || payment.createdAt || null, dueDate: null, validityDate: null,
      status: 'paid', currency: 'EUR',
      company: invoiceModel.company, customer: invoiceModel.customer,
      billingAddress: invoiceModel.billingAddress, serviceAddress: invoiceModel.serviceAddress,
      lines: [], sections: [],
      totals: {
        totalInclCents: totalCents, invoiceTotal: fromCents(totalCents),
        paymentAmountCents: toCents(payment.amount), paymentAmount: Number(payment.amount) || 0,
        cumulativePaidCents: cumulativeCents, cumulativePaid: fromCents(cumulativeCents),
        balanceAfterCents: Math.max(0, totalCents - cumulativeCents), balanceAfter: fromCents(Math.max(0, totalCents - cumulativeCents)),
      },
      references: { invoiceId: f.id, invoiceNumber: f.num || null, paymentId: payment.id, paymentMode: payment.mode || null, paymentReference: payment.reference || null },
      notes: '', terms: { conditions: '' }, options: invoiceModel.options,
      acceptance: null, payments: [payment],
      snapshotSource: invoiceModel.snapshotSource,
    };
  }

  const COMMERCIAL_FILENAME_MAX_LENGTH = 80;
  function sanitizeFilenameSegment(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents (é -> e)
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/-+/g, '-').replace(/^-|-$/g, '');
  }
  function buildCommercialDocumentFilename(type, model) {
    if (!model) return 'Document.pdf';
    const typePrefix = { devis: 'DEV', facture: 'FAC', recu: 'REC' }[type] || 'DOC';
    const rawNum = model.documentNumber ? sanitizeFilenameSegment(model.documentNumber) : 'BROUILLON';
    // documentNumber already carries its configured prefix (ex: "DEV-2026-0003") -- don't re-prepend typePrefix or it doubles up.
    const num = rawNum !== 'BROUILLON' && rawNum.toUpperCase().startsWith(typePrefix.toUpperCase())
      ? rawNum
      : [typePrefix, rawNum].filter(Boolean).join('-');
    const clientName = sanitizeFilenameSegment((model.customer && ((model.customer.prenom || '') + ' ' + (model.customer.nom || '')).trim()) || '') || 'Client';
    let base;
    if (type === 'recu') {
      const invNum = sanitizeFilenameSegment((model.references && model.references.invoiceNumber) || '');
      base = [num, invNum].filter(Boolean).join('-');
    } else {
      base = [num, clientName].filter(Boolean).join('-');
    }
    return base.slice(0, COMMERCIAL_FILENAME_MAX_LENGTH) + '.pdf';
  }

  /* Validation NON contraignante (section 30) -- sépare erreurs bloquantes
     (empêchent réellement l'envoi/l'émission) des avertissements (jamais
     bloquants, juste informatifs). */
  function getCommercialDocumentValidation(type, model) {
    const errors = [];
    const warnings = [];
    if (!model) { errors.push('Document introuvable.'); return { valid: false, errors, warnings }; }
    if (!model.customer || (!model.customer.nom && !model.customer.prenom)) errors.push('Aucun client sélectionné.');
    if (!model.lines || model.lines.length === 0) errors.push('Aucune ligne facturable.');
    if (!model.totals || !Number.isFinite(model.totals.totalInclCents) || model.totals.totalInclCents < 0) errors.push('Total invalide.');
    if (!model.company || !model.company.nom) warnings.push('Nom d\'entreprise manquant.');
    if (!model.customer || !model.customer.adresse) warnings.push('Client sans adresse.');
    if (!model.terms || !model.terms.conditions) warnings.push('Conditions absentes.');
    if (type === 'devis' && !model.validityDate) warnings.push('Date de validité absente.');
    if (type === 'facture' && !model.dueDate) warnings.push('Date d\'échéance absente.');
    return { valid: errors.length === 0, errors, warnings };
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

  /* Demandes publiques (feature/public-intake-conversion) -- statuts
     autorisés côté table dédiée (public_service_requests, voir migration)
     et mapping snake_case (colonnes Postgres) -> camelCase (convention JS
     du reste de SebaDB), même besoin que mapPublicRequestRow pour
     SebaDB.messages plus haut. */
  const PUBLIC_REQUEST_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'rejected', 'archived'];
  function mapPublicRequestRow(r) {
    return {
      id: r.id, publicReference: r.public_reference, status: r.status,
      contactName: r.contact_name, email: r.email, phone: r.phone, address: r.address,
      serviceId: r.service_id, serviceLabel: r.service_label,
      preferredDate: r.preferred_date, preferredTimeStart: r.preferred_time_start, preferredTimeEnd: r.preferred_time_end,
      description: r.description, source: r.source, ownerNote: r.owner_note,
      convertedClientId: r.converted_client_id, convertedQuoteId: r.converted_quote_id, convertedInterventionId: r.converted_intervention_id,
      createdAt: r.created_at, updatedAt: r.updated_at, convertedAt: r.converted_at,
    };
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

    /* Rapatriement manuel de l'état cloud (feature/public-intake-conversion :
       convert_public_service_request crée le client DIRECTEMENT côté
       serveur, en SQL, jamais via SebaDB.create() local -- sans ce rappel,
       state.clients resterait périmé après une conversion tant qu'aucun
       autre événement ne redéclenche ready(). Même logique que le
       rapatriement silencieux de ready() ci-dessous, exposée ici à la
       demande. Ne fait rien en mode démo/hors Supabase. */
    async pullFromServer() {
      if (!hasSupabase) return false;
      const cloud = await SupabaseAdapter.pull();
      if (cloud) {
        state = cloud; LocalAdapter.save(state);
        listeners.forEach(fn => { try { fn(); } catch (e) {} });
        return true;
      }
      return false;
    },
    syncStatus() { return { pending: loadQueue().length, failed: loadFailed().length, syncing: _syncing }; },

    hasData() { if (!state) loadState(); return state.clients.length > 0; },

    /* Identifiant public du compte (feature/public-intake-conversion) --
       même valeur que l'identifiant interne (auth.uid(), voir _accountId()
       plus haut) : aucun "slug" lisible n'existe dans Seba aujourd'hui
       (vérifié -- ni onboarding.html ni reglages.html n'en génèrent un),
       et en créer un impliquerait un second panneau d'administration
       (génération/unicité/édition) hors périmètre de cette fondation.
       L'UUID sert donc directement d'identifiant dans l'URL publique
       (demande.html?pro=<accountId>) -- déjà non-devinable, déjà la
       frontière RLS réelle de tout le reste de l'app. */
    accountId() { return adapter._accountId(); },
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

    /* Numérotation (feature/flexible-commercial-documents pour devis/
       facture/recu -- contrat inchangé, hors périmètre). Le COMPTEUR reste
       state.seq.* (mécanisme déjà fiable, jamais dupliqué) ; seul le FORMAT
       devient configurable via state.documentNumbering (préfixe/année/
       longueur), avec un repli par défaut si non configuré. Incrément
       atomique côté client unique (pas de concurrence multi-onglet gérée
       différemment d'avant) -- jamais recalculé, jamais recyclé. */
    nextNum(kind) {
      if (!state) loadState();
      if (kind === 'contrat') return '#C-' + String(++state.seq.contrat).padStart(4, '0');
      if (kind === 'devis' || kind === 'facture' || kind === 'recu') {
        const counter = ++state.seq[kind];
        const cfg = (state.documentNumbering && state.documentNumbering[kind]) || DEFAULT_DOCUMENT_NUMBERING[kind];
        return formatDocumentNumber(counter, cfg);
      }
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

      /* ═══ Indisponibilités (feature/team-availability-suggestions) ═══
         Lecture : profile() ci-dessus suffit déjà -- get_my_employee_profile()
         renvoie l'objet employé COMPLET (jamais un allowlist, l'employé est
         du personnel de confiance comme le reste de son portail), donc
         emp.unavailabilityRequests est déjà exposé sans RPC supplémentaire.
         Écriture : 2 RPC dédiées SECURITY DEFINER (create/cancel), même
         modèle que client_accept_devis (migrations/2026-07-26-quote-to-cash.sql) --
         auth.uid(), rattachement via employe_accounts, FOR UPDATE, ne
         modifie QUE unavailabilityRequests, jamais le reste de la fiche. */
      async createUnavailabilityRequest(startDate, endDate, reason) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('create_my_unavailability_request', { p_start_date: startDate, p_end_date: endDate, p_reason: reason || null });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        try {
          const raw = localStorage.getItem('seba_employee_session_demo');
          const demo = raw ? JSON.parse(raw) : null;
          if (!demo) return { ok: false, error: 'Non connecté.' };
          if (!startDate || !endDate || startDate > endDate) return { ok: false, error: 'Dates invalides.' };
          if (!reason || !reason.trim()) return { ok: false, error: 'Motif requis.' };
          const emp = state.employes.find(e => e.id === demo.employeId);
          if (!emp) return { ok: false, error: 'Fiche introuvable.' };
          SebaDB.scheduling.normalizeEmployeeAvailability(emp);
          const req = { id: uid(), startDate, endDate, reason: reason.trim(), status: 'pending', createdAt: new Date().toISOString(), reviewedAt: null, reviewedBy: null, reviewComment: null };
          const unavailabilityRequests = emp.unavailabilityRequests.concat([req]);
          SebaDB.update('employes', emp.id, { unavailabilityRequests });
          return { ok: true, request: req };
        } catch (e) { return { ok: false, error: e.message }; }
      },

      async cancelUnavailabilityRequest(requestId) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('cancel_my_unavailability_request', { p_request_id: requestId });
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
          SebaDB.scheduling.normalizeEmployeeAvailability(emp);
          const req = emp.unavailabilityRequests.find(r => r.id === requestId);
          if (!req) return { ok: false, error: 'Demande introuvable.' };
          if (req.status === 'cancelled') return { ok: true, request: req }; // idempotent
          if (req.status !== 'pending') return { ok: false, error: 'Impossible d\'annuler une demande déjà traitée.' };
          req.status = 'cancelled';
          req.reviewedAt = new Date().toISOString();
          SebaDB.update('employes', emp.id, { unavailabilityRequests: emp.unavailabilityRequests });
          return { ok: true, request: req };
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

      /* Vue "safe" locale d'UN devis/facture — même allowlist que les RPC
         get_my_client_devis_detail/get_my_client_facture_detail
         (migrations/2026-07-26-quote-to-cash.sql) : jamais notes/
         statusHistory/duplicatedFrom/sourceInterventionId (interne patron)
         envoyés au client, même en mode démo local. */
      _safeDevis(d) {
        return {
          id: d.id, num: d.num, date: d.date, status: d.status, lines: d.lines,
          tvaRate: d.tvaRate, remise: d.remise, acompte: d.acompte, validityDate: d.validityDate,
          conditions: d.conditions, totalHT: d.totalHT, totalTVA: d.totalTVA, totalTTC: d.totalTTC,
          sentAt: d.sentAt, acceptedAt: d.acceptedAt, refusedAt: d.refusedAt, refusalComment: d.refusalComment,
          invoiceId: d.invoiceId,
          parentQuoteId: d.parentQuoteId || null, revisionNumber: d.revisionNumber || 1, supersededByQuoteId: d.supersededByQuoteId || null,
          documentSnapshot: d.documentSnapshot || null,
        };
      },
      _safeFacture(f) {
        return {
          id: f.id, num: f.num, date: f.date, dueDate: f.dueDate, status: f.status, lines: f.lines,
          tvaRate: f.tvaRate, remise: f.remise, totalHT: f.totalHT, totalTVA: f.totalTVA, totalTTC: f.totalTTC,
          montantPaye: SebaDB.factures.paidAmount(f), solde: SebaDB.factures.balance(f),
          payments: (f.payments || []).map(p => ({ id: p.id, amount: p.amount, mode: p.mode, date: p.date, reference: p.reference, createdAt: p.createdAt })),
          devisId: f.devisId, interventionId: f.interventionId,
          documentSnapshot: f.documentSnapshot || null,
        };
      },

      async devisDetail(devisId) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('get_my_client_devis_detail', { p_devis_id: devisId });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_client_session_demo') || 'null'); } catch (e) {}
        const d = state.devis.find(x => x.id === devisId);
        if (!d) return { ok: false, error: 'Devis introuvable.' };
        if (demo && d.clientId !== demo.clientId) return { ok: false, error: 'Devis non associé à votre compte.' };
        if (d.status === 'brouillon') return { ok: false, error: 'Devis introuvable.' };
        return { ok: true, devis: SebaDB.clientPortal._safeDevis(d) };
      },

      async factureDetail(factureId) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('get_my_client_facture_detail', { p_facture_id: factureId });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_client_session_demo') || 'null'); } catch (e) {}
        const f = state.factures.find(x => x.id === factureId);
        if (!f) return { ok: false, error: 'Facture introuvable.' };
        if (demo && f.clientId !== demo.clientId) return { ok: false, error: 'Facture non associée à votre compte.' };
        return { ok: true, facture: SebaDB.clientPortal._safeFacture(f) };
      },

      /* Acceptation — persistante, horodatée, liée au client authentifié,
         idempotente (un second appel sur un devis déjà accepté PAR CE
         CLIENT ne crée aucun doublon d'événement, retourne l'état actuel).
         Impossible sur le devis d'un autre client : verrou côté serveur
         (RPC, clientId retrouvé via client_accounts) ; en local, même garde
         via la session démo. */
      async acceptDevis(devisId) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('client_accept_devis', { p_devis_id: devisId });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_client_session_demo') || 'null'); } catch (e) {}
        if (!demo) return { ok: false, error: 'Non connecté.' };
        const d = state.devis.find(x => x.id === devisId && x.clientId === demo.clientId);
        if (!d) return { ok: false, error: 'Devis introuvable ou non associé à votre compte.' };
        if (d.status === 'signe') return { ok: true, devis: SebaDB.clientPortal._safeDevis(d) }; // idempotent
        if (d.supersededByQuoteId) return { ok: false, error: 'Ce devis a été remplacé par une version plus récente.' };
        if (d.status !== 'attente') return { ok: false, error: 'Ce devis ne peut plus être accepté.' };
        const now = new Date().toISOString();
        const statusHistory = (d.statusHistory || []).concat([{ id: uid(), event: 'client_accepted', actorRole: 'client', actorId: demo.clientId, createdAt: now, metadata: null }]);
        SebaDB.update('devis', devisId, { status: 'signe', acceptedAt: now, acceptedBy: demo.clientId, statusHistory });
        return { ok: true, devis: SebaDB.clientPortal._safeDevis(SebaDB.get('devis', devisId)) };
      },

      async refuseDevis(devisId, comment) {
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.rpc('client_refuse_devis', { p_devis_id: devisId, p_comment: comment || null });
          if (res.error) return { ok: false, error: res.error.message };
          return res.data;
        }
        if (!state) loadState();
        let demo = null;
        try { demo = JSON.parse(localStorage.getItem('seba_client_session_demo') || 'null'); } catch (e) {}
        if (!demo) return { ok: false, error: 'Non connecté.' };
        if (!comment || !comment.trim()) return { ok: false, error: 'Un commentaire est requis pour refuser un devis.' };
        const d = state.devis.find(x => x.id === devisId && x.clientId === demo.clientId);
        if (!d) return { ok: false, error: 'Devis introuvable ou non associé à votre compte.' };
        if (d.status === 'refuse') return { ok: true, devis: SebaDB.clientPortal._safeDevis(d) }; // idempotent
        if (d.status === 'signe') return { ok: false, error: 'Devis déjà accepté, refus impossible.' };
        if (d.supersededByQuoteId) return { ok: false, error: 'Ce devis a été remplacé par une version plus récente.' };
        const now = new Date().toISOString();
        const statusHistory = (d.statusHistory || []).concat([{ id: uid(), event: 'client_refused', actorRole: 'client', actorId: demo.clientId, createdAt: now, metadata: { comment: comment.trim() } }]);
        SebaDB.update('devis', devisId, { status: 'refuse', refusedAt: now, refusedBy: demo.clientId, refusalComment: comment.trim(), statusHistory });
        return { ok: true, devis: SebaDB.clientPortal._safeDevis(SebaDB.get('devis', devisId)) };
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

    /* ═══ Entreprise (feature/public-intake-conversion) ═══════════════════
       Avant ce chantier, le nom/coordonnées d'entreprise (reglages.html)
       ne vivaient QUE dans localStorage.sebaEntreprise -- jamais poussés
       vers seba_state. L'Edge Function public-intake tourne côté serveur
       (aucun accès au navigateur du patron) : sans une copie synchronisée
       ici, "le vrai nom de l'entreprise" du formulaire public n'aurait
       aucune source possible. state.entreprise devient la source server-
       side ; localStorage.sebaEntreprise reste écrit en parallèle par
       reglages.html (cache instantané/hors-ligne, inchangé), les deux
       restent alignés à chaque saveGeneralInfo(). */
    entreprise: {
      get() { if (!state) loadState(); return state.entreprise || null; },
      set(patch) {
        if (!state) loadState();
        state.entreprise = Object.assign({}, state.entreprise || {}, patch || {});
        persist();
        return state.entreprise;
      },
    },

    /* ═══ Réglages documentaires (feature/flexible-commercial-documents) ═══
       Numérotation configurable (préfixe/année/longueur) + préférences
       d'affichage par défaut, surchargeables par document (voir
       buildDocumentSnapshot/buildQuoteDocumentModel/buildInvoiceDocumentModel
       plus haut dans ce fichier). Jamais un nouveau moteur : le compteur
       reste state.seq.*, consommé par SebaDB.nextNum(). */
    commercialSettings: {
      getNumbering() { if (!state) loadState(); return state.documentNumbering || JSON.parse(JSON.stringify(DEFAULT_DOCUMENT_NUMBERING)); },
      setNumbering(cfg) {
        if (!state) loadState();
        state.documentNumbering = Object.assign({}, DEFAULT_DOCUMENT_NUMBERING, state.documentNumbering || {}, cfg || {});
        persist();
        return state.documentNumbering;
      },
      getDisplayPrefs() { if (!state) loadState(); return state.documentDisplayPrefs || Object.assign({}, DEFAULT_DOCUMENT_DISPLAY_PREFS); },
      setDisplayPrefs(prefs) {
        if (!state) loadState();
        state.documentDisplayPrefs = Object.assign({}, DEFAULT_DOCUMENT_DISPLAY_PREFS, state.documentDisplayPrefs || {}, prefs || {});
        persist();
        return state.documentDisplayPrefs;
      },
    },

    /* ═══ Demandes publiques (feature/public-intake-conversion) ═══════════
       Source de vérité : table Postgres DÉDIÉE public_service_requests,
       jamais seba_state -- un visiteur sans compte Seba ne peut pas écrire
       dans state (aucune session, aucun auth.uid()), l'insertion réelle
       passe exclusivement par l'Edge Function public-intake (service_role,
       voir supabase-functions/public-intake.ts). Ce namespace ne fait que
       LIRE/écrire ce que le PATRON authentifié a le droit de voir (RLS :
       user_id = auth.uid(), voir migrations/2026-07-26-public-intake.sql)
       -- même convention REST directe que SebaDB.messages plus haut (seule
       autre collection qui parle à une vraie table plutôt qu'au blob
       JSONB générique). Pas de repli "mode démo" : une table dédiée
       n'existe pas en local, comme sebaAuth.rpc() lui-même. */
    publicIntake: {
      config() { if (!state) loadState(); return state.publicIntakeConfig || null; },
      setConfig(patch) {
        if (!state) loadState();
        state.publicIntakeConfig = Object.assign({
          enabled: false, title: '', introduction: '', allowedServiceIds: [],
          requireAddress: false, allowPreferredDate: true, confirmationMessage: '',
        }, state.publicIntakeConfig || {}, patch || {});
        persist();
        return state.publicIntakeConfig;
      },

      async list(filter) {
        if (!hasSupabase || !adapter._hasSession(window.SEBA_CONFIG)) return [];
        try {
          const cfg = window.SEBA_CONFIG;
          let url = cfg.supabaseUrl + '/rest/v1/public_service_requests?account=eq.' + encodeURIComponent(adapter._accountId()) + '&order=created_at.desc';
          if (filter && filter.status) url += '&status=eq.' + encodeURIComponent(filter.status);
          const res = await fetch(url, { headers: adapter._headers() });
          if (!res.ok) { console.warn('[seba-data] lecture demandes publiques en echec (HTTP ' + res.status + ').'); return []; }
          const rows = await res.json();
          return rows.map(mapPublicRequestRow);
        } catch (e) { console.warn('[seba-data] lecture demandes publiques impossible (reseau).', e.message); return []; }
      },

      async setStatus(id, status) {
        if (PUBLIC_REQUEST_STATUSES.indexOf(status) === -1) return { ok: false, error: 'Statut invalide.' };
        if (!hasSupabase || !adapter._hasSession(window.SEBA_CONFIG)) return { ok: false, error: 'Supabase non configuré.' };
        try {
          const cfg = window.SEBA_CONFIG;
          const res = await fetch(cfg.supabaseUrl + '/rest/v1/public_service_requests?id=eq.' + encodeURIComponent(id), {
            method: 'PATCH',
            headers: adapter._headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
            body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
          });
          if (!res.ok) return { ok: false, error: 'Échec de la mise à jour (HTTP ' + res.status + ').' };
          const rows = await res.json();
          return { ok: true, request: rows[0] ? mapPublicRequestRow(rows[0]) : null };
        } catch (e) { return { ok: false, error: e.message }; }
      },

      async setOwnerNote(id, note) {
        if (!hasSupabase || !adapter._hasSession(window.SEBA_CONFIG)) return { ok: false, error: 'Supabase non configuré.' };
        try {
          const cfg = window.SEBA_CONFIG;
          const res = await fetch(cfg.supabaseUrl + '/rest/v1/public_service_requests?id=eq.' + encodeURIComponent(id), {
            method: 'PATCH',
            headers: adapter._headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
            body: JSON.stringify({ owner_note: note || '', updated_at: new Date().toISOString() }),
          });
          if (!res.ok) return { ok: false, error: 'Échec de la mise à jour (HTTP ' + res.status + ').' };
          const rows = await res.json();
          return { ok: true, request: rows[0] ? mapPublicRequestRow(rows[0]) : null };
        } catch (e) { return { ok: false, error: e.message }; }
      },

      /* Conversion — 2 appels RPC atomiques/idempotents, jamais un calcul
         de devis/planning recréé côté SQL (voir migration : la RPC ne fait
         que résoudre/créer le CLIENT, simple mapping de champs sans aucune
         logique métier). Le devis (SebaDB.devis.createDraft, moteur
         quote-to-cash réel) et l'intervention non assignée sont créés ICI
         côté navigateur patron, en réutilisant tel quel les moteurs déjà
         écrits/testés -- écriture ensuite normale sur seba_state (RLS
         auth.uid()=user_id, comme toute autre page patron), puis reliés à
         la demande via linkConversion (idempotente, n'écrase jamais un id
         déjà posé -- un retry ne peut donc jamais lier un 2e devis/2e
         intervention à la même demande). */
      async claim(id, action) {
        if (!hasSupabase || !window.sebaAuth || !sebaAuth.isConfigured) return { ok: false, error: 'Supabase non configuré.' };
        const res = await sebaAuth.rpc('convert_public_service_request', { p_account: adapter._accountId(), p_request_id: id, p_action: action });
        if (res.error) return { ok: false, error: res.error.message };
        return res.data;
      },
      async linkConversion(id, quoteId, interventionId) {
        if (!hasSupabase || !window.sebaAuth || !sebaAuth.isConfigured) return { ok: false, error: 'Supabase non configuré.' };
        const res = await sebaAuth.rpc('link_public_service_request_conversion', { p_account: adapter._accountId(), p_request_id: id, p_quote_id: quoteId || null, p_intervention_id: interventionId || null });
        if (res.error) return { ok: false, error: res.error.message };
        return res.data;
      },
    },

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

    /* ═══ DEVIS — cycle de vie réel (feature/quote-to-cash) ═══════════════
       amount reste l'alias TTC historique (déjà affiché "Total TTC" dans
       devis.html avant ce chantier) -- maintenu en synchro à chaque écriture
       pour que tout le code existant qui le lit (dashboard.html, devis.html,
       client-fiche.html) continue de fonctionner sans modification.
       Statuts : brouillon (nouveau) -> attente (envoyé) -> signe/refuse
       (réponse client) ; expire/annule à tout moment côté patron. */
    devis: {
      /* Totaux calculés, jamais ressaisis : HT = somme des lignes - remise,
         TVA = HT × taux, TTC = HT + TVA. remise/acompte : {type:'percent'|
         'amount', value} ou null. Calcul PUR, volontairement indépendant de
         window.SebaQuotes.calculateQuoteTotals() (services/quote-engine.js,
         chargé uniquement par devis-nouveau.html) -- SebaDB.devis.* est
         appelé depuis des pages qui ne chargent pas ce moteur (dashboard,
         factures.html, ce script QA), un résultat qui dépendrait du contexte
         d'appel serait un bug silencieux (confirmé empiriquement : la remise
         disparaissait quand computeTotals() tournait sur app/dashboard.html,
         qui ne charge pas quote-engine.js). */
      computeTotals(input) {
        const lines = Array.isArray(input.lines) ? input.lines : [];
        const rawHT = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.u) || 0), 0);
        const remise = input.remise && Number(input.remise.value) > 0
          ? (input.remise.type === 'percent' ? rawHT * (Number(input.remise.value) / 100) : Number(input.remise.value))
          : 0;
        const totalHT = round2(Math.max(0, rawHT - remise));
        const totalTVA = round2(totalHT * ((Number(input.tvaRate) || 0) / 100));
        const totalTTC = round2(totalHT + totalTVA);
        let acompteMontant = 0;
        if (input.acompte && Number(input.acompte.value) > 0) {
          acompteMontant = round2(input.acompte.type === 'percent' ? totalTTC * (Number(input.acompte.value) / 100) : Number(input.acompte.value));
        }
        return { totalHT, totalTVA, totalTTC, acompteMontant };
      },

      /* Construit l'objet devis complet (jamais persisté ici -- l'appelant
         choisit create() pour un nouveau devis ou update() pour corriger un
         brouillon). status forcé par l'appelant (createDraft/send). */
      _buildPayload(input, status) {
        // Lignes RICHES (feature/flexible-commercial-documents, éditeurs
        // réels) -- normalizeCommercialLine préserve type/serviceId/details/
        // unit/discountType/discountValue/taxRate (plus les alias desc/qty/u
        // pour le code non migré), jamais réduites à {id,desc,qty,u} comme
        // avant ce correctif (qui effaçait silencieusement toute option
        // avancée saisie dans l'éditeur au moment de la sauvegarde).
        const remise = input.remise && Number(input.remise.value) > 0 ? { type: input.remise.type === 'percent' ? 'percent' : 'amount', value: Number(input.remise.value) } : null;
        const acompte = input.acompte && Number(input.acompte.value) > 0 ? { type: input.acompte.type === 'percent' ? 'percent' : 'amount', value: Number(input.acompte.value) } : null;
        const lines = (Array.isArray(input.lines) ? input.lines : [])
          .map(normalizeCommercialLine)
          .filter(l => (l.description || '').trim())
          .map((l, idx) => Object.assign({}, l, { position: idx }));
        const richTotals = buildCommercialDocumentTotals(lines, {
          documentTaxRate: Number(input.tvaRate) || 0,
          discountType: remise && remise.type, discountValue: remise && remise.value,
          depositType: acompte && acompte.type, depositValue: acompte && acompte.value,
        });
        const totals = { totalHT: richTotals.totalHT, totalTVA: richTotals.totalTVA, totalTTC: richTotals.totalTTC };
        return {
          clientId: input.clientId, clientName: input.clientName || '',
          service: input.service || (lines[0] ? (lines[0].description || lines[0].desc) : ''),
          lines,
          tvaRate: Number(input.tvaRate) || 0,
          remise, acompte,
          validityDate: input.validityDate || null,
          conditions: (input.conditions || '').trim(),
          notes: (input.notes || '').trim(), // interne patron -- jamais envoyé au client (voir migration RPC, allowlist)
          // Adresses/référence/options par document (sections 11 et 19) --
          // surcharges facultatives, jamais une modification de la fiche
          // client. internalReference : jamais dans le snapshot (interne).
          billingAddress: (input.billingAddress || '').trim(),
          serviceAddress: (input.serviceAddress || '').trim(),
          clientReference: (input.clientReference || '').trim(),
          internalReference: (input.internalReference || '').trim(),
          documentOptions: input.documentOptions && typeof input.documentOptions === 'object' ? input.documentOptions : null,
          sourceInterventionId: input.sourceInterventionId || null,
          // Demande publique d'origine (feature/pilot-ready-v1) -- absent
          // avant ce chantier, ajouté en cohérence avec sourceInterventionId
          // ci-dessus (même convention de nommage "sourceXxxId").
          sourceRequestId: input.sourceRequestId || null,
          totalHT: totals.totalHT, totalTVA: totals.totalTVA, totalTTC: totals.totalTTC,
          amount: totals.totalTTC, // alias legacy, voir en-tête de section
          status,
          date: todayISO(0),
          sentAt: status === 'attente' ? new Date().toISOString() : null,
          acceptedAt: null, acceptedBy: null,
          refusedAt: null, refusedBy: null, refusalComment: null,
          cancelledAt: null,
          invoiceId: null,
          // Révisions (feature/flexible-commercial-documents) -- absents
          // avant ce chantier, toujours null/0 pour un brouillon/un premier
          // envoi normal.
          parentQuoteId: input.parentQuoteId || null, revisionNumber: Number(input.revisionNumber) || 1, supersededByQuoteId: null,
          // Snapshot documentaire (section 12) -- posé UNIQUEMENT au premier
          // envoi (status 'attente'), jamais recalculé ensuite : un devis
          // brouillon n'a pas encore de version figée.
          documentSnapshot: status === 'attente' ? buildDocumentSnapshot('devis', {
            clientId: input.clientId, clientName: input.clientName, lines, tvaRate: Number(input.tvaRate) || 0,
            remise, acompte, conditions: input.conditions, notes: input.notes,
            validityDate: input.validityDate, totals,
            billingAddress: input.billingAddress, serviceAddress: input.serviceAddress,
            clientReference: input.clientReference, documentOptions: input.documentOptions,
          }, state) : null,
          statusHistory: [{ id: uid(), event: status === 'attente' ? 'sent' : 'draft_created', actorRole: 'patron', actorId: null, createdAt: new Date().toISOString(), metadata: null }],
          history: [{ label: status === 'attente' ? 'Devis envoyé' : 'Brouillon créé', date: todayISO(0), cls: 'o' }], // legacy, lu par la side-sheet devis.html
        };
      },

      createDraft(input) {
        if (!state) loadState();
        const payload = SebaDB.devis._buildPayload(input, 'brouillon');
        const d = SebaDB.create('devis', Object.assign({ num: SebaDB.nextNum('devis') }, payload));
        SebaDB.log('devis', 'Brouillon de devis créé — ' + (d.clientName || 'client'), 'devis.html');
        return { ok: true, devis: d };
      },

      /* createQuoteRevision (section 16) -- fonction canonique unique pour
         créer une nouvelle version d'un devis déjà envoyé. Copie lignes/
         options commerciales/conditions, jamais l'acceptation/le refus/les
         paiements, ne modifie JAMAIS l'ancien devis (marqué supersededByQuoteId
         uniquement quand CETTE révision est réellement envoyée, voir
         updateDraft ci-dessous -- jamais à la création, sinon le client
         perdrait temporairement toute version acceptable). */
      createRevision(quoteId) {
        if (!state) loadState();
        const src = state.devis.find(d => d.id === quoteId);
        if (!src) return { ok: false, error: 'Devis introuvable.' };
        if (src.status === 'brouillon') return { ok: false, error: 'Un brouillon n\'a pas besoin de révision -- modifiez-le directement.' };
        const payload = SebaDB.devis._buildPayload({
          clientId: src.clientId, clientName: src.clientName, lines: src.lines, tvaRate: src.tvaRate,
          remise: src.remise, acompte: src.acompte, validityDate: src.validityDate, conditions: src.conditions,
          service: src.service, sourceInterventionId: src.sourceInterventionId, sourceRequestId: src.sourceRequestId,
          parentQuoteId: src.id, revisionNumber: (Number(src.revisionNumber) || 1) + 1,
        }, 'brouillon');
        const revision = SebaDB.create('devis', Object.assign({ num: SebaDB.nextNum('devis') }, payload));
        SebaDB.log('devis', 'Révision créée depuis ' + src.num + ' — ' + (revision.clientName || 'client'), 'devis.html');
        return { ok: true, devis: revision };
      },

      send(input) {
        if (!state) loadState();
        const payload = SebaDB.devis._buildPayload(input, 'attente');
        const d = SebaDB.create('devis', Object.assign({ num: SebaDB.nextNum('devis') }, payload));
        SebaDB.log('devis', 'Devis envoyé ' + d.num + ' — ' + (d.clientName || 'client') + ' · ' + d.amount + ' €', 'devis.html');
        return { ok: true, devis: d };
      },

      /* Corrige un brouillon existant (jamais un devis déjà envoyé/décidé --
         un devis "attente"/"signe"/"refuse" reste immuable dans son contenu,
         seul le statut évolue via les actions dédiées). */
      updateDraft(id, input) {
        if (!state) loadState();
        const existing = state.devis.find(d => d.id === id);
        if (!existing) return { ok: false, error: 'Devis introuvable.' };
        if (existing.status !== 'brouillon') return { ok: false, error: 'Seul un brouillon peut être corrigé.' };
        const sendNow = !!input._send;
        // parentQuoteId/revisionNumber (feature/flexible-commercial-documents) :
        // TOUJOURS préservés depuis l'existant si l'appelant ne les
        // repasse pas explicitement -- jamais perdus silencieusement (le
        // formulaire d'édition ne les affiche/renvoie pas forcément à
        // chaque sauvegarde).
        const mergedInput = Object.assign({
          parentQuoteId: existing.parentQuoteId, revisionNumber: existing.revisionNumber,
        }, input);
        const payload = SebaDB.devis._buildPayload(mergedInput, sendNow ? 'attente' : 'brouillon');
        delete payload.statusHistory; delete payload.history;
        SebaDB.update('devis', id, payload);
        if (sendNow) {
          const d = state.devis.find(x => x.id === id);
          d.statusHistory = (d.statusHistory || []).concat([{ id: uid(), event: 'sent', actorRole: 'patron', actorId: null, createdAt: new Date().toISOString(), metadata: null }]);
          d.history = [{ label: 'Devis envoyé', date: todayISO(0), cls: 'o' }].concat(d.history || []);
          SebaDB.update('devis', id, { statusHistory: d.statusHistory, history: d.history });
          // Révision réellement envoyée -> l'ancienne version devient
          // remplacée (jamais à la création du brouillon, voir createRevision).
          if (d.parentQuoteId) SebaDB.update('devis', d.parentQuoteId, { supersededByQuoteId: d.id });
        }
        SebaDB.log('devis', (sendNow ? 'Devis envoyé ' : 'Brouillon mis à jour ') + existing.num, 'devis.html');
        return { ok: true, devis: SebaDB.get('devis', id) };
      },

      /* Duplication = toujours un nouveau BROUILLON (jamais un ré-envoi
         immédiat -- distinct de la fonction existante renouveler() dans
         devis.html, conservée telle quelle, qui renvoie tout de suite). */
      duplicate(id) {
        if (!state) loadState();
        const src = state.devis.find(d => d.id === id);
        if (!src) return { ok: false, error: 'Devis introuvable.' };
        const payload = SebaDB.devis._buildPayload(src, 'brouillon');
        payload.duplicatedFrom = id;
        const d = SebaDB.create('devis', Object.assign({ num: SebaDB.nextNum('devis') }, payload));
        SebaDB.log('devis', 'Devis dupliqué (brouillon) depuis ' + src.num + ' — ' + (d.clientName || 'client'), 'devis.html');
        return { ok: true, devis: d };
      },

      cancel(id) {
        if (!state) loadState();
        const d = state.devis.find(x => x.id === id);
        if (!d) return { ok: false, error: 'Devis introuvable.' };
        if (d.status === 'annule') return { ok: true, devis: d };
        if (d.invoiceId) return { ok: false, error: 'Ce devis a déjà été converti en facture, impossible de l\'annuler.' };
        const statusHistory = (d.statusHistory || []).concat([{ id: uid(), event: 'cancelled', actorRole: 'patron', actorId: null, createdAt: new Date().toISOString(), metadata: null }]);
        SebaDB.update('devis', id, { status: 'annule', cancelledAt: new Date().toISOString(), statusHistory });
        SebaDB.log('devis', 'Devis annulé ' + d.num, 'devis.html');
        return { ok: true, devis: SebaDB.get('devis', id) };
      },
    },

    /* ═══ FACTURES — statuts + paiements réels (feature/quote-to-cash) ════
       Statuts (nouveau vocabulaire, cf. plan) : draft/issued/partially_paid/
       paid/overdue/cancelled. Les anciens statuts (payee/attente/retard,
       données de démo seed()) restent lisibles partout via les helpers
       isPaid/isOverdue/isPending ci-dessous plutôt qu'une migration de
       données de démo -- jamais une comparaison littérale dupliquée
       ailleurs dans le code (dashboard.html, factures.html). */
    factures: {
      isPaid(f) { return f.status === 'paid' || f.status === 'payee'; },
      isOverdue(f) { return f.status === 'overdue' || f.status === 'retard'; },
      isCancelled(f) { return f.status === 'cancelled' || f.status === 'annulee'; },
      isPartial(f) { return f.status === 'partially_paid'; },
      isDraft(f) { return f.status === 'draft'; },
      // "en attente de paiement, pas encore en retard" -- englobe issued/
      // partially_paid/attente (legacy), exclut explicitement l'échu.
      isAwaiting(f) { return !SebaDB.factures.isPaid(f) && !SebaDB.factures.isOverdue(f) && !SebaDB.factures.isCancelled(f) && !SebaDB.factures.isDraft(f); },
      total(f) { return f.totalTTC != null ? f.totalTTC : (f.amount || 0); },
      paidAmount(f) {
        if (Array.isArray(f.payments)) return round2(f.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
        return SebaDB.factures.isPaid(f) ? SebaDB.factures.total(f) : 0;
      },
      balance(f) { return round2(Math.max(0, SebaDB.factures.total(f) - SebaDB.factures.paidAmount(f))); },

      /* Construit l'objet facture complet pour une facture LIBRE ou éditée
         depuis factures-nouvelle.html (feature/flexible-commercial-documents,
         éditeurs) -- même patron que SebaDB.devis._buildPayload : lignes
         riches préservées via normalizeCommercialLine, totaux calculés par
         le moteur centralisé buildCommercialDocumentTotals, jamais un second
         calcul. status forcé par l'appelant (createDraft/updateDraft). */
      _buildPayload(input, status) {
        const remise = input.remise && Number(input.remise.value) > 0 ? { type: input.remise.type === 'percent' ? 'percent' : 'amount', value: Number(input.remise.value) } : null;
        const lines = (Array.isArray(input.lines) ? input.lines : [])
          .map(normalizeCommercialLine)
          .filter(l => (l.description || '').trim())
          .map((l, idx) => Object.assign({}, l, { position: idx }));
        const richTotals = buildCommercialDocumentTotals(lines, {
          documentTaxRate: Number(input.tvaRate) || 0,
          discountType: remise && remise.type, discountValue: remise && remise.value,
        });
        return {
          clientId: input.clientId, clientName: input.clientName || '',
          service: input.service || (lines[0] ? (lines[0].description || lines[0].desc) : ''),
          lines, tvaRate: Number(input.tvaRate) || 0, remise,
          totalHT: richTotals.totalHT, totalTVA: richTotals.totalTVA, totalTTC: richTotals.totalTTC,
          amount: richTotals.totalTTC, // alias legacy
          status, date: todayISO(0), dueDate: input.dueDate || null, paidAt: null,
          devisId: input.devisId || null, interventionId: input.interventionId || null,
          conditions: (input.conditions || '').trim(),
          billingAddress: (input.billingAddress || '').trim(),
          serviceAddress: (input.serviceAddress || '').trim(),
          clientReference: (input.clientReference || '').trim(),
          internalReference: (input.internalReference || '').trim(),
          documentOptions: input.documentOptions && typeof input.documentOptions === 'object' ? input.documentOptions : null,
          payments: [], notes: (input.notes || '').trim(), cancelledAt: null,
          // Snapshot (section 12) -- posé UNIQUEMENT à l'émission (status
          // 'issued'), jamais pour un brouillon -- même règle que le devis.
          documentSnapshot: status === 'issued' ? buildDocumentSnapshot('facture', {
            clientId: input.clientId, clientName: input.clientName, lines, tvaRate: Number(input.tvaRate) || 0,
            remise, acompte: null, conditions: input.conditions, notes: input.notes,
            billingAddress: input.billingAddress, serviceAddress: input.serviceAddress,
            clientReference: input.clientReference, documentOptions: input.documentOptions,
          }, state) : null,
          statusHistory: [{ id: uid(), event: status === 'issued' ? 'issued' : 'draft_created', actorRole: 'patron', actorId: null, createdAt: new Date().toISOString(), metadata: null }],
        };
      },

      createDraft(input) {
        if (!state) loadState();
        const payload = SebaDB.factures._buildPayload(input, 'draft');
        const f = SebaDB.create('factures', Object.assign({ num: null }, payload));
        SebaDB.log('facture', 'Brouillon de facture créé — ' + (f.clientName || 'client'), 'factures.html');
        return { ok: true, facture: f };
      },

      /* Corrige un brouillon existant, ou l'émet si input._emit est vrai
         (assigne le numéro stable + le snapshot, jamais recalculés ensuite --
         même contrat que SebaDB.devis.updateDraft/_send). Un brouillon
         DEVIENT le document définitif à l'émission, jamais un second objet
         créé (idempotent : ré-émettre un objet déjà 'issued' est refusé). */
      updateDraft(id, input) {
        if (!state) loadState();
        const existing = state.factures.find(f => f.id === id);
        if (!existing) return { ok: false, error: 'Facture introuvable.' };
        if (existing.status !== 'draft') return { ok: false, error: 'Seul un brouillon peut être corrigé.' };
        const emitNow = !!input._emit;
        const payload = SebaDB.factures._buildPayload(input, emitNow ? 'issued' : 'draft');
        if (emitNow) payload.num = SebaDB.nextNum('facture');
        else delete payload.num;
        delete payload.statusHistory;
        SebaDB.update('factures', id, payload);
        if (emitNow) {
          const f = state.factures.find(x => x.id === id);
          f.statusHistory = (f.statusHistory || []).concat([{ id: uid(), event: 'issued', actorRole: 'patron', actorId: null, createdAt: new Date().toISOString(), metadata: null }]);
          SebaDB.update('factures', id, { statusHistory: f.statusHistory });
        }
        SebaDB.log('facture', (emitNow ? 'Facture émise ' + (SebaDB.get('factures', id) || {}).num : 'Brouillon de facture mis à jour ') + (existing.num || ''), 'factures.html');
        return { ok: true, facture: SebaDB.get('factures', id) };
      },

      /* Duplication = toujours un nouveau BROUILLON, jamais un ré-émission
         immédiate (même règle que SebaDB.devis.duplicate). */
      duplicate(id) {
        if (!state) loadState();
        const src = state.factures.find(f => f.id === id);
        if (!src) return { ok: false, error: 'Facture introuvable.' };
        const payload = SebaDB.factures._buildPayload(src, 'draft');
        payload.duplicatedFrom = id;
        const f = SebaDB.create('factures', Object.assign({ num: null }, payload));
        SebaDB.log('facture', 'Facture dupliquée (brouillon) depuis ' + (src.num || '(brouillon)') + ' — ' + (f.clientName || 'client'), 'factures.html');
        return { ok: true, facture: f };
      },

      /* Reprend les lignes/totaux d'un devis ACCEPTÉ sans ressaisie (section
         7 du chantier) -- jamais une nouvelle saisie manuelle des montants.
         status 'issued' immédiatement (même convention que
         createInvoiceFromIntervention ci-dessous : le patron reste sur
         factures.html pour envoyer/finaliser, mais le document existe déjà
         tel quel, pas un brouillon vide à reremplir). */
      createFromDevis(devisId) {
        if (!state) loadState();
        const d = state.devis.find(x => x.id === devisId);
        if (!d) return { ok: false, error: 'Devis introuvable.' };
        if (d.status !== 'signe') return { ok: false, error: 'Seul un devis accepté peut être converti en facture.' };
        if (d.invoiceId) return { ok: false, error: 'Une facture existe déjà pour ce devis.' };
        // Snapshot (section 12) -- réutilise TEL QUEL celui du devis déjà
        // envoyé (figé au moment de l'acceptation, garantit que la facture
        // reflète exactement ce que le client a accepté) ; reconstruit
        // seulement en repli pour un vieux devis signé avant ce chantier
        // (jamais de documentSnapshot posé à l'époque).
        const snapshot = d.documentSnapshot || buildDocumentSnapshot('facture', {
          clientId: d.clientId, clientName: d.clientName, lines: d.lines, tvaRate: d.tvaRate,
          remise: d.remise, acompte: d.acompte, conditions: d.conditions, notes: '',
        }, state);
        const facture = SebaDB.create('factures', {
          num: SebaDB.nextNum('facture'), clientId: d.clientId, clientName: d.clientName,
          service: d.service, lines: d.lines, tvaRate: d.tvaRate, remise: d.remise,
          totalHT: d.totalHT, totalTVA: d.totalTVA, totalTTC: d.totalTTC, amount: d.totalTTC,
          status: 'issued', date: todayISO(0), dueDate: null, paidAt: null,
          devisId: d.id, interventionId: d.sourceInterventionId || null,
          conditions: d.conditions || '',
          payments: [], notes: '', cancelledAt: null,
          documentSnapshot: snapshot,
          statusHistory: [{ id: uid(), event: 'created_from_devis', actorRole: 'patron', actorId: null, createdAt: new Date().toISOString(), metadata: { devisId: d.id } }],
        });
        SebaDB.update('devis', d.id, { invoiceId: facture.id });
        SebaDB.log('facture', 'Facture générée depuis le devis ' + d.num + ' — ' + (facture.clientName || 'client') + ' · ' + facture.amount + ' €', 'factures.html');
        return { ok: true, facture };
      },

      /* Enregistre un paiement (partiel ou total) -- le solde et le statut
         sont TOUJOURS recalculés à partir de payments[], jamais saisis
         (section 11 du chantier). mode/date/reference/note : note reste
         strictement patron (jamais exposée au client, voir migration RPC). */
      recordPayment(factureId, payment) {
        if (!state) loadState();
        const f = state.factures.find(x => x.id === factureId);
        if (!f) return { ok: false, error: 'Facture introuvable.' };
        const amount = Number(payment && payment.amount);
        if (!amount || amount <= 0) return { ok: false, error: 'Montant de paiement invalide.' };
        if (SebaDB.factures.isCancelled(f)) return { ok: false, error: 'Facture annulée, impossible d\'enregistrer un paiement.' };
        const entry = {
          id: uid(), amount: round2(amount), mode: (payment.mode || 'autre'),
          date: payment.date || todayISO(0), reference: (payment.reference || '').trim(),
          note: (payment.note || '').trim(), createdAt: new Date().toISOString(),
        };
        const payments = (Array.isArray(f.payments) ? f.payments : []).concat([entry]);
        const total = SebaDB.factures.total(Object.assign({}, f, { payments }));
        const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
        const newStatus = paid >= total ? 'paid' : (paid > 0 ? 'partially_paid' : f.status);
        const statusHistory = (f.statusHistory || []).concat([{ id: uid(), event: 'payment_recorded', actorRole: 'patron', actorId: null, createdAt: new Date().toISOString(), metadata: { amount: entry.amount, mode: entry.mode } }]);
        const patch = { payments, status: newStatus, statusHistory };
        if (newStatus === 'paid') patch.paidAt = new Date().toISOString();
        SebaDB.update('factures', factureId, patch);
        SebaDB.log('facture', 'Paiement enregistré ' + f.num + ' — ' + entry.amount + ' € (' + entry.mode + ')', 'factures.html');
        return { ok: true, facture: SebaDB.get('factures', factureId) };
      },

      cancel(id) {
        if (!state) loadState();
        const f = state.factures.find(x => x.id === id);
        if (!f) return { ok: false, error: 'Facture introuvable.' };
        if (SebaDB.factures.isPaid(f)) return { ok: false, error: 'Facture déjà payée, impossible de l\'annuler.' };
        const statusHistory = (f.statusHistory || []).concat([{ id: uid(), event: 'cancelled', actorRole: 'patron', actorId: null, createdAt: new Date().toISOString(), metadata: null }]);
        SebaDB.update('factures', id, { status: 'cancelled', cancelledAt: new Date().toISOString(), statusHistory });
        SebaDB.log('facture', 'Facture annulée ' + f.num, 'factures.html');
        return { ok: true, facture: SebaDB.get('factures', id) };
      },
    },

    /* ═══ Moteur d'automatisations -- écritures (feature/automation-engine-
       foundation) ═══ Toutes les fonctions de CALCUL pur vivent au niveau
       module (normalizeAutomationRule/validateAutomationRule/
       evaluateAutomationConditions/planAutomationActions/
       executeAutomationRule/processBusinessEvent/emitBusinessEvent/
       detectBusinessEvents/runAutomationsPass, voir plus haut dans ce
       fichier) -- ce namespace n'est que la couche CRUD patron + les
       exécuteurs d'action réels (les seuls à appeler SebaDB.create/update
       pour de vrai), même contrat que SebaDB.devis/SebaDB.employes. */
    automations: {
      /* Déclenche une passe manuelle (utile pour un bouton "Vérifier
         maintenant" et pour les scripts QA) -- la passe automatique tourne
         déjà sur SebaDB.onChange, voir l'enregistrement du listener en toute
         fin de fichier. */
      run() {
        if (!state) loadState();
        return runAutomationsPass(state);
      },

      /* Événement dont la SOURCE n'est pas une collection seba_state (ex.
         service_request_created/service_request_converted -- feature/
         public-intake-conversion, table dédiée public_service_requests,
         jamais scannée par detectBusinessEvents ci-dessus). Même
         dédoublonnage que le scan (automationRuns, sourceId+triggerType) :
         un rappel avec le même sourceId+type ne retraite jamais. Compose
         emitBusinessEvent/processBusinessEvent tels quels, aucune logique
         de moteur dupliquée ici. */
      processExternalEvent(type, sourceType, sourceId, data) {
        if (!state) loadState();
        const already = (state.automationRuns || []).some(r => r.sourceId === sourceId && r.triggerType === type);
        if (already) return { skipped: true };
        const event = emitBusinessEvent(type, { sourceType, sourceId, data });
        processBusinessEvent(event, state, 0);
        return { skipped: false };
      },

      list() { if (!state) loadState(); return (state.automationRules || []).slice(); },
      runs(ruleId) { if (!state) loadState(); return (state.automationRuns || []).filter(r => !ruleId || r.ruleId === ruleId).slice(); },
      alerts() { if (!state) loadState(); return (state.automationAlerts || []).slice(); },

      createRule(input) {
        if (!state) loadState();
        const rule = normalizeAutomationRule(Object.assign({}, input, { id: undefined, createdAt: undefined, updatedAt: undefined, lastRunAt: null, runCount: 0 }));
        const check = validateAutomationRule(rule);
        if (!check.valid) return { ok: false, error: check.errors.join(' ') };
        if (rule.active) {
          const activeCount = (state.automationRules || []).filter(r => r.active).length;
          if (activeCount >= AUTOMATION_MAX_ACTIVE_RULES) return { ok: false, error: 'Maximum ' + AUTOMATION_MAX_ACTIVE_RULES + ' règles actives par compte.' };
        }
        const created = SebaDB.create('automationRules', rule);
        SebaDB.log('automation', 'Automatisation créée — ' + created.name, 'automatisations.html');
        return { ok: true, rule: created };
      },

      updateRule(id, patch) {
        if (!state) loadState();
        const existing = state.automationRules.find(r => r.id === id);
        if (!existing) return { ok: false, error: 'Règle introuvable.' };
        const merged = normalizeAutomationRule(Object.assign({}, existing, patch, { id, updatedAt: new Date().toISOString() }));
        const check = validateAutomationRule(merged);
        if (!check.valid) return { ok: false, error: check.errors.join(' ') };
        if (merged.active && !existing.active) {
          const activeCount = state.automationRules.filter(r => r.active && r.id !== id).length;
          if (activeCount >= AUTOMATION_MAX_ACTIVE_RULES) return { ok: false, error: 'Maximum ' + AUTOMATION_MAX_ACTIVE_RULES + ' règles actives par compte.' };
        }
        SebaDB.update('automationRules', id, {
          name: merged.name, active: merged.active, trigger: merged.trigger, conditions: merged.conditions,
          actions: merged.actions, updatedAt: merged.updatedAt,
        });
        return { ok: true, rule: SebaDB.get('automationRules', id) };
      },

      setActive(id, active) { return SebaDB.automations.updateRule(id, { active: !!active }); },

      duplicateRule(id) {
        if (!state) loadState();
        const src = state.automationRules.find(r => r.id === id);
        if (!src) return { ok: false, error: 'Règle introuvable.' };
        return SebaDB.automations.createRule({
          name: src.name + ' (copie)', active: false,
          trigger: JSON.parse(JSON.stringify(src.trigger)),
          conditions: JSON.parse(JSON.stringify(src.conditions)),
          actions: JSON.parse(JSON.stringify(src.actions)),
        });
      },

      removeRule(id) {
        if (!state) loadState();
        const existing = state.automationRules.find(r => r.id === id);
        if (!existing) return { ok: false, error: 'Règle introuvable.' };
        SebaDB.remove('automationRules', id);
        return { ok: true };
      },

      resolveAlert(id, status) {
        if (['resolved', 'dismissed'].indexOf(status) === -1) return { ok: false, error: 'Statut invalide.' };
        if (!state) loadState();
        const alert = state.automationAlerts.find(a => a.id === id);
        if (!alert) return { ok: false, error: 'Alerte introuvable.' };
        SebaDB.update('automationAlerts', id, { status });
        return { ok: true, alert: SebaDB.get('automationAlerts', id) };
      },

      /* Modèles activables (section 5 du chantier) -- copie profonde
         retournée, jamais l'objet const partagé (une page pourrait le
         muter par erreur). */
      templates() { return AUTOMATION_TEMPLATES.map(t => JSON.parse(JSON.stringify(t))); },
      createFromTemplate(templateId) {
        const tpl = AUTOMATION_TEMPLATES.find(t => t.id === templateId);
        if (!tpl) return { ok: false, error: 'Modèle introuvable.' };
        return SebaDB.automations.createRule({
          name: tpl.name, active: false,
          trigger: JSON.parse(JSON.stringify(tpl.trigger)),
          conditions: JSON.parse(JSON.stringify(tpl.conditions)),
          actions: JSON.parse(JSON.stringify(tpl.actions)),
        });
      },

      /* ── Exécuteurs d'action réels (section 4 du chantier) -- seuls
         points d'écriture pour une automatisation, tous réutilisent les
         méthodes SebaDB existantes, jamais une réécriture de la logique
         métier. ── */
      _runAction(type, config, event, state, rule) {
        config = config || {};
        switch (type) {
          case 'create_follow_up_intervention': return SebaDB.automations._actionFollowUp(config, event, state);
          case 'create_invoice_draft': return SebaDB.automations._actionInvoiceDraft(config, event, state);
          case 'add_client_memory_entry': return SebaDB.automations._actionMemoryEntry(config, event, state);
          case 'create_owner_alert': return SebaDB.automations._actionOwnerAlert(config, event, state, rule);
          case 'update_intervention_status': return SebaDB.automations._actionUpdateStatus(config, event, state);
          default: return { ok: false, error: 'Action inconnue.' };
        }
      },

      _renderTemplate(tpl, event, state) {
        const coll = AUTOMATION_SOURCE_COLLECTION[event.sourceType];
        const source = (coll && state[coll]) ? state[coll].find(x => x.id === event.sourceId) : null;
        return String(tpl || '').replace(/\{\{(\w+)\}\}/g, (m, key) => {
          if (event.data && event.data[key] !== undefined && event.data[key] !== null) return event.data[key];
          if (source && source[key] !== undefined && source[key] !== null) return source[key];
          return '';
        });
      },

      /* 1. create_follow_up_intervention -- intervention de suivi réelle,
         date = date de l'intervention source + delayDays. */
      _actionFollowUp(config, event, state) {
        if (event.sourceType !== 'intervention') return { ok: false, error: 'Source non compatible.' };
        const source = state.interventions.find(i => i.id === event.sourceId);
        if (!source) return { ok: false, error: 'Intervention source introuvable.' };
        const delayDays = Number(config.delayDays) || 0;
        const base = new Date((source.date || todayISO(0)) + 'T00:00:00');
        base.setDate(base.getDate() + delayDays);
        const employee = config.assignEmployeeId ? state.employes.find(e => e.id === config.assignEmployeeId) : null;
        const created = SebaDB.create('interventions', {
          date: localISO(base), time: source.time || '09:00',
          clientId: config.copyClient !== false ? source.clientId : null,
          clientName: config.copyClient !== false ? source.clientName : '',
          service: config.service || source.service || 'Suivi',
          duree: config.duration || source.duree || null,
          adresse: config.copyAddress !== false ? (source.adresse || '') : '',
          employeId: employee ? employee.id : null,
          employeName: employee ? (employee.prenom + ' ' + employee.nom).trim() : null,
          done: false, sourceInterventionId: source.id, createdByAutomation: true,
        });
        return { ok: true, id: created.id };
      },

      /* 2. create_invoice_draft -- réutilise EXACTEMENT le moteur Quote-to-
         Cash/Intervention 360 existant, jamais une réécriture. */
      _actionInvoiceDraft(config, event, state) {
        if (event.sourceType === 'devis') {
          const res = SebaDB.factures.createFromDevis(event.sourceId);
          return res.ok ? { ok: true, id: res.facture.id } : { ok: false, error: res.error };
        }
        if (event.sourceType === 'intervention') {
          const res = SebaDB.interventions.createInvoiceFromIntervention(event.sourceId);
          return res.ok ? { ok: true, id: res.facture.id } : { ok: false, error: res.error };
        }
        return { ok: false, error: 'Source non compatible.' };
      },

      /* 3. add_client_memory_entry -- réutilise SebaDB.clients.addMemoryEntry
         existant (feature/client-crm-advanced), source:'system' explicite. */
      _actionMemoryEntry(config, event, state) {
        const clientId = resolveClientIdForEvent(event, state);
        if (!clientId) return { ok: false, error: 'Client introuvable pour cet événement.' };
        const content = SebaDB.automations._renderTemplate(config.contentTemplate || '', event, state);
        const entry = SebaDB.clients.addMemoryEntry(clientId, {
          type: MEMORY_TYPES.indexOf(config.category) !== -1 ? config.category : 'instruction',
          title: 'Automatisation', content,
          visibility: MEMORY_VISIBILITY.indexOf(config.visibility) !== -1 ? config.visibility : 'internal_team',
          source: 'system',
        });
        return entry ? { ok: true, id: entry.id } : { ok: false, error: 'Échec de l\'ajout à la mémoire (catégorie invalide ?).' };
      },

      /* 4. create_owner_alert -- nouvelle collection automationAlerts,
         jamais mélangée aux priorityActions du dashboard (lecture seule
         côté dashboard, voir app/dashboard.html). */
      _actionOwnerAlert(config, event, state, rule) {
        const alert = SebaDB.create('automationAlerts', {
          title: SebaDB.automations._renderTemplate(config.title || 'Alerte automatisation', event, state) || 'Alerte automatisation',
          message: SebaDB.automations._renderTemplate(config.message || '', event, state),
          priority: ['low', 'medium', 'high'].indexOf(config.priority) !== -1 ? config.priority : 'medium',
          href: config.href || null, status: 'active', ruleId: rule.id, eventId: event.id,
        });
        return { ok: true, id: alert.id };
      },

      /* 5. update_intervention_status -- transition restreinte, voir
         planAutomationActions() pour l'allowlist (même liste que la RPC
         Intervention 360 existante, jamais un contournement). */
      _actionUpdateStatus(config, event, state) {
        const interv = state.interventions.find(i => i.id === event.sourceId);
        if (!interv) return { ok: false, error: 'Intervention introuvable.' };
        SebaDB.update('interventions', interv.id, { statut: config.status, done: config.status === 'terminee' });
        return { ok: true, id: interv.id };
      },
    },

    /* ═══ Dispatch/planning (feature/smart-planning-dispatch) ═══════════
       Fonctions PURES de calcul horaire -- même logique que celle déjà
       écrite dans app/dashboard.html (parseDureeToMinutes/addMinutesToTime/
       détection de chevauchement pour teamCapacity.conflicts), reprise ici
       à l'identique pour que planning.html et la RPC-like côté patron
       (SebaDB.interventions.reschedule/assign ci-dessous) partagent
       EXACTEMENT la même définition d'un conflit -- jamais une deuxième
       règle de calcul divergente. */
    scheduling: {
      parseDureeToMinutes(str) {
        // Deux formats réels coexistent selon la page d'origine de
        // l'intervention : "2h"/"2h30" (planning.html, format historique
        // lu par app/dashboard.html) OU un nombre brut de minutes
        // (intervention-fiche.html, champ "Durée (minutes)" -- trouvé en
        // câblant le moteur de disponibilité sur prepareIntervention()).
        // Les deux sont acceptés ici pour que "toutes les comparaisons
        // utilisent les vraies durées" quelle que soit la page d'origine,
        // sans jamais migrer les données existantes.
        if (str === null || str === undefined || str === '') return 0;
        const m = /^(\d+)h(\d{2})?$/.exec(String(str).trim());
        if (m) return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
        const n = Number(str);
        return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
      },
      addMinutesToTime(time, minutes) {
        const parts = String(time || '00:00').split(':').map(Number);
        const total = (parts[0] || 0) * 60 + (parts[1] || 0) + minutes;
        const hh = Math.floor(total / 60) % 24, mm = total % 60;
        return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
      },
      heureFin(intervention) {
        if (!intervention.time) return null;
        return SebaDB.scheduling.addMinutesToTime(intervention.time, SebaDB.scheduling.parseDureeToMinutes(intervention.duree));
      },
      /* Un candidat (date/time/duree/employeId déjà fusionnés par
         l'appelant) chevauche-t-il une AUTRE intervention du même employé,
         le même jour ? excludeId : jamais comparé à lui-même (cas d'une
         intervention existante qu'on déplace). Retourne l'intervention en
         conflit (premier trouvé) ou null. */
      findConflict(interventions, candidate, excludeId) {
        if (!candidate.employeId || !candidate.date || !candidate.time) return null;
        const candFin = SebaDB.scheduling.heureFin(candidate);
        if (!candFin) return null;
        const others = interventions.filter(i =>
          i.id !== excludeId && i.employeId === candidate.employeId && i.date === candidate.date && i.time
        );
        for (const other of others) {
          const otherFin = SebaDB.scheduling.heureFin(other);
          if (!otherFin) continue;
          // Chevauchement classique [start,end) : A commence avant que B finisse ET B commence avant que A finisse.
          if (candidate.time < otherFin && other.time < candFin) return other;
        }
        return null;
      },
      /* Tous les conflits d'une date donnée, toutes équipes confondues --
         même forme que app/dashboard.html (teamCapacity.conflicts),
         réutilisée par planning.html pour l'affichage des badges. */
      findDayConflicts(interventions, dateISO) {
        const byEmploye = {};
        interventions.filter(i => i.date === dateISO && i.employeId && i.time).forEach(i => {
          (byEmploye[i.employeId] = byEmploye[i.employeId] || []).push(i);
        });
        const conflicts = [];
        Object.keys(byEmploye).forEach(eid => {
          const list = byEmploye[eid].slice().sort((a, b) => a.time.localeCompare(b.time));
          for (let k = 0; k < list.length - 1; k++) {
            const finK = SebaDB.scheduling.heureFin(list[k]);
            if (finK && finK > list[k + 1].time) conflicts.push({ employeId: eid, a: list[k], b: list[k + 1] });
          }
        });
        return conflicts;
      },

      /* ═══ Moteur de disponibilité (feature/team-availability-suggestions) ═══
         Fonctions PURES, jamais d'écriture ici -- voir SebaDB.employes.* et
         SebaDB.interventions.reschedule/assign pour les écritures qui les
         utilisent. Extension rétrocompatible de l'employé existant :
         "active" du chantier == le champ RÉEL déjà utilisé partout ailleurs
         (dashboard.html teamCapacity, equipe.html, employe-fiche.html) est
         `actif`, jamais un second champ `active` qui désynchroniserait tout
         le reste de l'app (filtre dashboard, badge équipe...) -- décision
         explicite, pas un oubli. */
      DAYS_OF_WEEK: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      dayKeyForDate(dateISO) {
        // getDay() : 0=dimanche..6=samedi -> réindexé sur DAYS_OF_WEEK (lundi en tête, convention déjà utilisée par planning.html/DAY_NAMES).
        const jsDay = new Date(dateISO + 'T00:00:00').getDay();
        return SebaDB.scheduling.DAYS_OF_WEEK[(jsDay + 6) % 7];
      },

      normalizeEmployeeAvailability(employee) {
        if (typeof employee.actif !== 'boolean') employee.actif = true;
        if (!Array.isArray(employee.skills)) employee.skills = [];
        const wa = employee.weeklyAvailability;
        if (!wa || typeof wa !== 'object') {
          employee.weeklyAvailability = {};
          SebaDB.scheduling.DAYS_OF_WEEK.forEach(d => { employee.weeklyAvailability[d] = []; });
        } else {
          SebaDB.scheduling.DAYS_OF_WEEK.forEach(d => { if (!Array.isArray(wa[d])) wa[d] = []; });
        }
        if (employee.maxWeeklyMinutes === undefined) employee.maxWeeklyMinutes = null;
        if (!Array.isArray(employee.unavailabilityRequests)) employee.unavailabilityRequests = [];
        return employee;
      },

      /* {date, start, end} -- start/end en "HH:MM", jamais recalculés
         ailleurs (une seule source pour la plage horaire d'une intervention). */
      getInterventionTimeRange(intervention) {
        if (!intervention || !intervention.date || !intervention.time) return null;
        const end = SebaDB.scheduling.heureFin(intervention) || intervention.time;
        return { date: intervention.date, start: intervention.time, end };
      },

      /* Minutes déjà planifiées pour un employé sur LA SEMAINE (7 jours
         depuis weekStart inclus) -- jamais une intervention comptée deux
         fois, jamais un calcul dupliqué ailleurs (utilisé par les warnings
         de plafond ET par le classement de suggestion, critère 5). */
      getEmployeeWeeklyPlannedMinutes(employeeId, interventions, weekStart) {
        const start = new Date(weekStart + 'T00:00:00');
        const end = new Date(start); end.setDate(end.getDate() + 7);
        return interventions
          .filter(i => i.employeId === employeeId && i.date && new Date(i.date + 'T00:00:00') >= start && new Date(i.date + 'T00:00:00') < end)
          .reduce((sum, i) => sum + SebaDB.scheduling.parseDureeToMinutes(i.duree), 0);
      },

      _requestOverlapsDate(req, dateISO) {
        if (!req.startDate || !req.endDate || !dateISO) return false;
        return req.startDate <= dateISO && dateISO <= req.endDate;
      },

      /* Distingue BLOCKERS (assignation impossible, jamais contournable
         sans force explicite) et WARNINGS (avertissement, confirmation
         patron suffisante). Chaque entrée : {code, message[, detail]}.
         `interventions` : liste COMPLETE (l'appelant ne doit PAS avoir déjà
         retiré l'intervention en cours -- exclusion gérée ici via excludeId,
         même convention que findConflict ci-dessus). */
      getEmployeeAssignmentBlockers(employee, intervention, interventions, excludeId) {
        SebaDB.scheduling.normalizeEmployeeAvailability(employee);
        const blockers = [];
        const warnings = [];

        if (!employee.actif) {
          blockers.push({ code: 'employee_inactive', message: (employee.prenom || 'Cet employé') + ' n\'est plus actif.' });
        }

        const range = SebaDB.scheduling.getInterventionTimeRange(intervention);
        if (range) {
          const accepted = (employee.unavailabilityRequests || []).find(r => r.status === 'accepted' && SebaDB.scheduling._requestOverlapsDate(r, range.date));
          if (accepted) blockers.push({ code: 'accepted_unavailability', message: (employee.prenom || 'Cet employé') + ' est indisponible du ' + accepted.startDate + ' au ' + accepted.endDate + '.', detail: accepted });

          const pending = (employee.unavailabilityRequests || []).find(r => r.status === 'pending' && SebaDB.scheduling._requestOverlapsDate(r, range.date));
          if (pending) warnings.push({ code: 'pending_unavailability', message: 'Une demande d\'indisponibilité est en attente pour cette période.', detail: pending });

          const conflict = SebaDB.scheduling.findConflict(interventions, Object.assign({}, intervention, { employeId: employee.id }), excludeId);
          if (conflict) blockers.push({ code: 'schedule_conflict', message: 'Conflit horaire : ' + (employee.prenom || 'cet employé') + ' a déjà une mission sur ce créneau.', detail: { id: conflict.id, time: conflict.time, clientName: conflict.clientName } });

          // Hors disponibilité habituelle -- uniquement si CE JOUR précis a
          // des créneaux configurés (règle explicite du chantier : un jour
          // vide reste neutre, jamais bloquant en soi -- seul l'objet
          // weeklyAvailability entièrement vide vaut "aucune restriction").
          const dayKey = SebaDB.scheduling.dayKeyForDate(range.date);
          const daySlots = employee.weeklyAvailability[dayKey] || [];
          if (daySlots.length > 0) {
            const fits = daySlots.some(s => s.start <= range.start && range.end <= s.end);
            if (!fits) blockers.push({ code: 'outside_regular_availability', message: (employee.prenom || 'Cet employé') + ' n\'est habituellement pas disponible à cet horaire.' });
          }
        }

        if (employee.skills.length > 0 && intervention.service && employee.skills.indexOf(intervention.service) === -1) {
          warnings.push({ code: 'missing_skill', message: (employee.prenom || 'Cet employé') + ' n\'a pas la compétence "' + intervention.service + '" déclarée.' });
        }

        if (employee.maxWeeklyMinutes != null && range) {
          const weekStart = (function () { const d = new Date(range.date + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localISO(d); })();
          const already = SebaDB.scheduling.getEmployeeWeeklyPlannedMinutes(employee.id, (interventions || []).filter(i => i.id !== excludeId), weekStart);
          const thisDuration = SebaDB.scheduling.parseDureeToMinutes(intervention.duree);
          if (already + thisDuration > employee.maxWeeklyMinutes) {
            warnings.push({ code: 'weekly_capacity_exceeded', message: 'Dépasse le plafond hebdomadaire de ' + (employee.prenom || 'cet employé') + ' (' + Math.round(employee.maxWeeklyMinutes / 60) + 'h/semaine).' });
          }
        }

        return { blockers, warnings };
      },

      /* Classement déterministe (section 5 du chantier) -- exclut d'abord
         tout employé avec un blocker dur, classe le reste selon les 7
         critères imposés, dans l'ordre exact. Retourne aussi `excluded`
         (raisons réelles, jamais un faux résultat quand personne ne
         convient). */
      rankEmployeesForIntervention(intervention, employees, interventions) {
        const range = SebaDB.scheduling.getInterventionTimeRange(intervention);
        const weekStart = range ? (function () { const d = new Date(range.date + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localISO(d); })() : null;
        const ranked = [];
        const excluded = [];

        employees.forEach(employee => {
          const check = SebaDB.scheduling.getEmployeeAssignmentBlockers(employee, intervention, interventions, intervention.id);
          const fullName = (employee.prenom + ' ' + employee.nom).trim();
          if (check.blockers.length > 0) {
            excluded.push({ employeeId: employee.id, name: fullName, blockers: check.blockers });
            return;
          }
          const weeklyMinutes = weekStart ? SebaDB.scheduling.getEmployeeWeeklyPlannedMinutes(employee.id, interventions.filter(i => i.id !== intervention.id), weekStart) : 0;
          const weeklyCount = weekStart
            ? interventions.filter(i => i.id !== intervention.id && i.employeId === employee.id && i.date >= weekStart && new Date(i.date + 'T00:00:00') < new Date(new Date(weekStart + 'T00:00:00').getTime() + 7 * 864e5)).length
            : 0;
          const hasSkillWarning = check.warnings.some(w => w.code === 'missing_skill');
          const hasPendingWarning = check.warnings.some(w => w.code === 'pending_unavailability');
          const hasCapacityWarning = check.warnings.some(w => w.code === 'weekly_capacity_exceeded');
          ranked.push({
            employeeId: employee.id, name: fullName, warnings: check.warnings,
            weeklyMinutes, weeklyCount,
            sortKey: [hasSkillWarning ? 1 : 0, 0, hasPendingWarning ? 1 : 0, hasCapacityWarning ? 1 : 0, weeklyMinutes, weeklyCount, fullName.toLowerCase()],
          });
        });

        ranked.sort((a, b) => {
          for (let i = 0; i < a.sortKey.length; i++) {
            if (a.sortKey[i] < b.sortKey[i]) return -1;
            if (a.sortKey[i] > b.sortKey[i]) return 1;
          }
          return 0;
        });

        return { ranked, excluded };
      },
    },

    /* ═══ Compétences/disponibilités employé (feature/team-availability-
       suggestions) -- écritures patron directes (RLS seba_state normale,
       même droits que le reste), jamais un second objet employé. ═══ */
    employes: {
      normalizeAvailability(employee) { return SebaDB.scheduling.normalizeEmployeeAvailability(employee); },

      setActive(employeeId, active) {
        if (!state) loadState();
        const emp = state.employes.find(e => e.id === employeeId);
        if (!emp) return { ok: false, error: 'Employé introuvable.' };
        SebaDB.update('employes', employeeId, { actif: !!active });
        SebaDB.log('employe', (active ? 'Employé réactivé — ' : 'Employé désactivé — ') + (emp.prenom + ' ' + emp.nom).trim(), 'employe-fiche.html?id=' + employeeId);
        return { ok: true, employe: SebaDB.get('employes', employeeId) };
      },

      setSkills(employeeId, skills) {
        if (!state) loadState();
        const emp = state.employes.find(e => e.id === employeeId);
        if (!emp) return { ok: false, error: 'Employé introuvable.' };
        const clean = Array.isArray(skills) ? [...new Set(skills.filter(s => typeof s === 'string' && s.trim()))] : [];
        SebaDB.update('employes', employeeId, { skills: clean });
        return { ok: true, employe: SebaDB.get('employes', employeeId) };
      },

      setMaxWeeklyMinutes(employeeId, minutes) {
        if (!state) loadState();
        const emp = state.employes.find(e => e.id === employeeId);
        if (!emp) return { ok: false, error: 'Employé introuvable.' };
        const v = (minutes === null || minutes === '' || minutes === undefined) ? null : Math.max(0, Math.round(Number(minutes) || 0));
        SebaDB.update('employes', employeeId, { maxWeeklyMinutes: v });
        return { ok: true, employe: SebaDB.get('employes', employeeId) };
      },

      /* Remplace la liste des créneaux d'UN jour (le patron enregistre
         toute la journée à chaque modification -- plus simple/robuste
         qu'un patch créneau par créneau, et le seul point d'entrée pour
         cette écriture, jamais dupliqué ailleurs). Validation stricte :
         start<end, aucun chevauchement entre créneaux du même jour --
         refusée ici, jamais persistée à moitié. */
      setDayAvailability(employeeId, dayKey, slots) {
        if (!state) loadState();
        const emp = state.employes.find(e => e.id === employeeId);
        if (!emp) return { ok: false, error: 'Employé introuvable.' };
        if (SebaDB.scheduling.DAYS_OF_WEEK.indexOf(dayKey) === -1) return { ok: false, error: 'Jour invalide.' };
        const clean = (Array.isArray(slots) ? slots : []).map(s => ({ start: String(s.start || ''), end: String(s.end || '') }));
        for (const s of clean) {
          if (!/^\d{2}:\d{2}$/.test(s.start) || !/^\d{2}:\d{2}$/.test(s.end) || s.start >= s.end) {
            return { ok: false, error: 'Créneau invalide : l\'heure de fin doit être après l\'heure de début.' };
          }
        }
        const sorted = clean.slice().sort((a, b) => a.start.localeCompare(b.start));
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].end > sorted[i + 1].start) return { ok: false, error: 'Ces créneaux se chevauchent.' };
        }
        SebaDB.scheduling.normalizeEmployeeAvailability(emp);
        const weeklyAvailability = Object.assign({}, emp.weeklyAvailability, { [dayKey]: sorted });
        SebaDB.update('employes', employeeId, { weeklyAvailability });
        return { ok: true, employe: SebaDB.get('employes', employeeId) };
      },

      /* Réponse patron à une demande d'indisponibilité (pending -> accepted/
         rejected). Jamais sur une demande déjà cancelled/résolue -- l'état
         final d'une demande est immuable une fois quittée 'pending' (règle
         explicite du chantier : "ne plus modifier une demande cancelled"). */
      resolveUnavailabilityRequest(employeeId, requestId, accept, comment) {
        if (!state) loadState();
        const emp = state.employes.find(e => e.id === employeeId);
        if (!emp) return { ok: false, error: 'Employé introuvable.' };
        SebaDB.scheduling.normalizeEmployeeAvailability(emp);
        const req = emp.unavailabilityRequests.find(r => r.id === requestId);
        if (!req) return { ok: false, error: 'Demande introuvable.' };
        if (req.status !== 'pending') return { ok: false, error: 'Cette demande n\'est plus en attente.' };
        req.status = accept ? 'accepted' : 'rejected';
        req.reviewedAt = new Date().toISOString();
        req.reviewedBy = 'patron';
        req.reviewComment = (comment || '').trim();
        SebaDB.update('employes', employeeId, { unavailabilityRequests: emp.unavailabilityRequests });
        SebaDB.log('employe', 'Demande d\'indisponibilité ' + (accept ? 'acceptée' : 'refusée') + ' — ' + (emp.prenom + ' ' + emp.nom).trim(), 'employe-fiche.html?id=' + employeeId);
        return { ok: true, employe: SebaDB.get('employes', employeeId) };
      },
    },

    /* ═══ Briefing de mission + retour terrain (feature/client-crm-advanced) ═══ */
    interventions: {
      /* Déplacement/modification horaire/réassignation (feature/smart-
         planning-dispatch) -- écriture patron directe (RLS seba_state
         normale), jamais un second système : passe par SebaDB.update comme
         toute autre écriture, la synchro T3 (pushOp -> sync-push) reste
         automatique, aucun appel explicite nécessaire ici.
         patch : sous-ensemble de {date, time, duree, employeId, employeName}.
         opts.force=true : ignore un conflit détecté et l'écrit quand même
         (le patron a déjà vu l'avertissement et confirmé -- "un conflit
         doit être visible AVANT validation", jamais un blocage silencieux
         ni une validation automatique). opts.allowLocked=true : autorise le
         déplacement d'une mission déjà validée par le patron (owner_approved)
         -- réservé à un flux de réouverture EXPLICITE, jamais implicite. */
      reschedule(interventionId, patch, opts) {
        if (!state) loadState();
        const interv = state.interventions.find(i => i.id === interventionId);
        if (!interv) return { ok: false, error: 'Intervention introuvable.' };
        normalizeIntervention(interv);
        if (interv.execution.completionStatus === 'owner_approved' && !(opts && opts.allowLocked)) {
          return { ok: false, error: 'Mission terminée et validée -- réouvrez le dossier avant de la déplacer.', locked: true };
        }
        const candidate = Object.assign({}, interv, patch);
        // Moteur de disponibilité (feature/team-availability-suggestions) --
        // SEULE fonction de blocage/avertissement, jamais une deuxième
        // logique locale : planning.html/intervention-fiche.html passent par
        // ce même reschedule()/assign(), jamais un contournement direct.
        if (candidate.employeId) {
          const employee = state.employes.find(e => e.id === candidate.employeId);
          if (employee) {
            const check = SebaDB.scheduling.getEmployeeAssignmentBlockers(employee, candidate, state.interventions, interventionId);
            if (check.blockers.length > 0 && !(opts && opts.force)) {
              const b = check.blockers[0];
              const scheduleConflict = check.blockers.find(x => x.code === 'schedule_conflict');
              return { ok: false, error: b.message, blockers: check.blockers, warnings: check.warnings, conflict: scheduleConflict ? scheduleConflict.detail : undefined };
            }
            if (check.warnings.length > 0 && !(opts && opts.force)) {
              return { ok: false, error: check.warnings[0].message, warnings: check.warnings, needsConfirm: true };
            }
          }
        }
        const statusHistory = (interv.statusHistory || []).concat([{ id: uid(), event: 'rescheduled', actorRole: 'patron', actorId: null, createdAt: new Date().toISOString(), metadata: patch }]);
        SebaDB.update('interventions', interventionId, Object.assign({}, patch, { statusHistory }));
        SebaDB.log('intervention', 'Intervention replanifiée — ' + (interv.clientName || 'client') + (patch.date ? ' · ' + patch.date : '') + (patch.time ? ' ' + patch.time : ''), 'planning.html');
        return { ok: true, intervention: SebaDB.get('interventions', interventionId) };
      },

      /* Assignation/réassignation seule (raccourci de reschedule() sans
         changer date/heure) -- même garde-fous (verrou owner_approved,
         conflit visible avant validation). */
      assign(interventionId, employeId, employeName, opts) {
        return SebaDB.interventions.reschedule(interventionId, { employeId: employeId || null, employeName: employeId ? (employeName || null) : null }, opts);
      },

      /* Résout une demande de report client (intervention.rescheduleRequest,
         posée par request_my_intervention_reschedule() côté client --
         migrations/2026-07-25-intervention-360.sql). accept=true : met à
         jour la VRAIE date de l'intervention (section règles métier du
         chantier) -- passe par reschedule() donc soumis aux mêmes garde-
         fous (verrou/conflit). accept=false : ne touche JAMAIS
         date/time/employeId, conserve le commentaire client tel quel,
         seul le statut de la demande change. */
      resolveRescheduleRequest(interventionId, accept, opts) {
        if (!state) loadState();
        const interv = state.interventions.find(i => i.id === interventionId);
        if (!interv) return { ok: false, error: 'Intervention introuvable.' };
        if (!interv.rescheduleRequest || interv.rescheduleRequest.status !== 'pending') {
          return { ok: false, error: 'Aucune demande de report en attente.' };
        }
        const req = Object.assign({}, interv.rescheduleRequest, { status: accept ? 'accepted' : 'declined', resolvedAt: new Date().toISOString() });
        if (accept) {
          const res = SebaDB.interventions.reschedule(interventionId, { date: req.requestedDate, rescheduleRequest: req }, opts);
          if (!res.ok) return res; // conflit/verrou : la demande reste 'pending', rien n'est modifié
          const withEvent = state.interventions.find(i => i.id === interventionId);
          pushStatusHistory(withEvent, 'reschedule_request_accepted', 'patron', null, { requestedDate: req.requestedDate });
          SebaDB.update('interventions', interventionId, { statusHistory: withEvent.statusHistory });
          return { ok: true, intervention: SebaDB.get('interventions', interventionId) };
        }
        pushStatusHistory(interv, 'reschedule_request_declined', 'patron', null, { comment: req.comment });
        SebaDB.update('interventions', interventionId, { rescheduleRequest: req, statusHistory: interv.statusHistory });
        SebaDB.log('intervention', 'Demande de report refusée — ' + (interv.clientName || 'client'), 'planning.html');
        return { ok: true, intervention: SebaDB.get('interventions', interventionId) };
      },

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
         consignes/exigences photo. Champs déjà librement modifiables par le
         patron (aucune RLS ne les restreint) ; pushStatusHistory() ici
         uniquement pour l'événement "prepared"/"assigned" (historique
         explicite, jamais fabriqué après coup).
         feature/team-availability-suggestions : branche le MÊME moteur de
         disponibilité que SebaDB.interventions.reschedule() (jamais une
         deuxième logique) dès que patch touche employeId -- retour enrichi
         {ok, blockers, warnings, conflict, needsConfirm}, opts.force=true
         pour écrire malgré un avertissement/conflit déjà vu et confirmé par
         le patron. Rétrocompatible : un appelant qui ignore le retour (code
         existant avant ce chantier) continue de fonctionner tant qu'aucun
         blocker ne s'applique -- seul un NOUVEL appelant qui vérifie res.ok
         profite du refus explicite. */
      prepareIntervention(interventionId, patch, opts) {
        if (!state) loadState();
        const intervention = state.interventions.find(i => i.id === interventionId);
        if (!intervention) return { ok: false, error: 'Intervention introuvable.' };
        normalizeIntervention(intervention);

        if (patch.employeId !== undefined && patch.employeId) {
          const employee = state.employes.find(e => e.id === patch.employeId);
          if (employee) {
            const candidate = Object.assign({}, intervention, patch);
            const check = SebaDB.scheduling.getEmployeeAssignmentBlockers(employee, candidate, state.interventions, interventionId);
            if (check.blockers.length > 0 && !(opts && opts.force)) {
              const b = check.blockers[0];
              const scheduleConflict = check.blockers.find(x => x.code === 'schedule_conflict');
              return { ok: false, error: b.message, blockers: check.blockers, warnings: check.warnings, conflict: scheduleConflict ? scheduleConflict.detail : undefined };
            }
            if (check.warnings.length > 0 && !(opts && opts.force)) {
              return { ok: false, error: check.warnings[0].message, warnings: check.warnings, needsConfirm: true };
            }
          }
        }

        const wasUnassigned = !intervention.employeId;
        const willBeAssigned = patch.employeId !== undefined ? patch.employeId : intervention.employeId;
        if (willBeAssigned && wasUnassigned) pushStatusHistory(intervention, 'assigned', 'patron', null, { employeId: willBeAssigned });
        else pushStatusHistory(intervention, 'prepared', 'patron', null, null);
        SebaDB.update('interventions', interventionId, Object.assign({}, patch, { statusHistory: intervention.statusHistory }));
        return { ok: true, intervention: SebaDB.get('interventions', interventionId) };
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
        if (intervention.invoiceId) {
          // Idempotent (même contrat que createFromAcceptedQuote) : un
          // retry/double-clic renvoie la facture déjà créée, jamais une
          // erreur -- l'éditeur (factures-nouvelle.html?interventionId=)
          // doit pouvoir rouvrir cette facture sans jamais bloquer.
          const already = state.factures.find(f => f.id === intervention.invoiceId);
          if (already) return { ok: true, facture: already, alreadyExisted: true };
        }
        if (intervention.execution.completionStatus !== 'owner_approved') return { ok: false, error: 'Le dossier doit être validé avant de facturer.' };
        // Brouillon éditable (feature/flexible-commercial-documents, éditeurs)
        // -- JAMAIS émise automatiquement à 0€ (correctif : avant ce chantier
        // cette fonction créait directement une facture 'issued', verrouillée,
        // sans passer par l'éditeur -- contraire à la section 10). Le patron
        // vérifie/complète le prix sur factures-nouvelle.html?id=... avant
        // d'émettre réellement (numéro + snapshot posés uniquement à ce
        // moment-là par SebaDB.factures.updateDraft(id,{_emit:true})).
        // Une seule ligne prérempilie avec le service réel de la mission,
        // prix à 0 (le patron le connaît, jamais inventé ici) -- aucune note
        // interne employé/incident/photo copiée (hors périmètre financier).
        const payload = SebaDB.factures._buildPayload({
          clientId: intervention.clientId, clientName: intervention.clientName || '',
          service: intervention.service || '',
          lines: intervention.service ? [{ description: intervention.service, quantity: 1, unitPriceCents: 0, unit: 'intervention' }] : [],
          tvaRate: 20, interventionId: intervention.id,
        }, 'draft');
        const facture = SebaDB.create('factures', Object.assign({ num: null }, payload));
        pushStatusHistory(intervention, 'invoice_created', 'patron', null, { factureId: facture.id });
        SebaDB.update('interventions', interventionId, { invoiceId: facture.id, statusHistory: intervention.statusHistory });
        SebaDB.log('facture', 'Brouillon de facture préremplie créé depuis la mission — ' + (intervention.clientName || 'client'), 'factures.html');
        return { ok: true, facture };
      },

      /* Conversion CANONIQUE devis accepté -> intervention (feature/pilot-
         ready-v1) -- seule voie autorisée pour cette conversion. Idempotente
         par construction (findExistingConversion, jamais un simple verrou
         d'UI) : un retry/double-clic renvoie l'intervention déjà créée,
         jamais un doublon. Ne copie jamais l'objet devis entier -- ne
         reprend que les champs opérationnels utiles au terrain (client,
         service, adresse, durée si connue), jamais prix/TVA/remise/acompte
         (ceux-ci restent uniquement sur le devis/la facture). Réutilise
         SebaDB.create('interventions', ...) tel quel : generateMissionBrief
         s'applique automatiquement (briefing sans aucune donnée financière,
         déjà garanti par ce mécanisme existant, jamais réécrit ici). */
      createFromAcceptedQuote(quoteId, options) {
        if (!state) loadState();
        options = options || {};
        if (!quoteId) return { ok: false, error: 'Devis requis.' };
        const d = state.devis.find(x => x.id === quoteId);
        if (!d) return { ok: false, error: 'Devis introuvable.' };

        // Idempotence déterministe AVANT toute validation de statut : un
        // retry sur un devis déjà converti doit renvoyer l'intervention
        // existante même si, entre-temps, le devis a été annulé -- jamais
        // recréer, jamais échouer sur un état qui n'empêche pas de retrouver
        // l'objet déjà produit.
        const existing = findExistingConversion('devis', quoteId, 'intervention', state);
        if (existing) {
          if (d.interventionId !== existing.id) SebaDB.update('devis', d.id, { interventionId: existing.id });
          return { ok: true, intervention: existing, alreadyExisted: true };
        }

        if (d.status === 'annule') return { ok: false, error: 'Ce devis est annulé, impossible de créer une intervention.' };
        if (d.status === 'refuse') return { ok: false, error: 'Ce devis a été refusé, impossible de créer une intervention.' };
        if (d.status !== 'signe') return { ok: false, error: 'Seul un devis accepté peut être converti en intervention.' };
        if (!d.clientId) return { ok: false, error: 'Devis sans client associé.' };
        const client = state.clients.find(c => c.id === d.clientId);
        if (!client) return { ok: false, error: 'Client introuvable.' };

        // Service principal -- ordre de résolution strict (section 3 du
        // chantier), jamais un service inventé. d.service est déjà résolu
        // par SebaDB.devis._buildPayload à la création (jamais vide pour un
        // vrai devis) : le cas "ambigu" ne couvre que d'anciennes données
        // incomplètes.
        let service = d.service || null;
        if (!service && options.serviceIdOverride) {
          const svc = (state.custom_services || []).find(s => s.id === options.serviceIdOverride);
          service = svc ? svc.name : options.serviceIdOverride;
        }
        if (!service) return { ok: false, error: 'Service ambigu : indiquez serviceIdOverride avant de créer l\'intervention.', needsServiceChoice: true };

        // Durée -- ordre de résolution strict, jamais un prix/une quantité
        // transformé en durée (aucun de ces 2 champs n'existe sur le devis
        // réel aujourd'hui, seul options.durationMinutes peut aboutir).
        let durationMinutes = null;
        if (Number.isFinite(d.durationMinutes)) durationMinutes = d.durationMinutes;
        else if (Array.isArray(d.lines) && d.lines.some(l => Number.isFinite(l.durationMinutes))) {
          durationMinutes = d.lines.reduce((s, l) => s + (Number.isFinite(l.durationMinutes) ? l.durationMinutes : 0), 0);
        } else if (Number.isFinite(options.durationMinutes)) durationMinutes = options.durationMinutes;

        const employee = options.employeeId ? state.employes.find(e => e.id === options.employeeId) : null;
        const created = SebaDB.create('interventions', {
          clientId: d.clientId, clientName: d.clientName || fullName(client),
          service, duree: durationMinutes != null ? String(durationMinutes) : null,
          adresse: options.addressOverride || client.adresse || '',
          date: options.date || null, time: options.startTime || null,
          employeId: employee ? employee.id : null, employeName: employee ? (employee.prenom + ' ' + employee.nom).trim() : null,
          done: false,
          sourceQuoteId: d.id, sourceRequestId: d.sourceRequestId || null,
          instructions: (d.conditions || '').trim() || null,
        });

        SebaDB.update('devis', d.id, { interventionId: created.id });
        SebaDB.log('intervention', 'Intervention créée depuis le devis accepté ' + d.num + ' — ' + (created.clientName || 'client'), 'intervention-fiche.html?id=' + created.id);
        // Événement automatisation intervention_created : émis par le scan
        // réactif existant (detectBusinessEvents, déclenché par le persist()
        // de SebaDB.create ci-dessus) -- jamais dupliqué manuellement ici,
        // et jamais avant cette écriture (elle vient de se terminer).
        return { ok: true, intervention: SebaDB.get('interventions', created.id), alreadyExisted: false };
      },
    },
  };

  window.SebaDB = SebaDB;

  /* ── Déclenchement automatique du moteur d'automatisations
     (feature/automation-engine-foundation) -- branché sur le SEUL
     mécanisme réactif déjà existant de toute l'app (persist() -> notifie
     les listeners de onChange()), jamais un setInterval/polling. Couvre
     à la fois les écritures locales du patron ET les écritures serveur
     (RPC client/employé) rapatriées par SupabaseAdapter.pull() (qui
     appelle aussi persist()). Garde de ré-entrance : une action
     d'automatisation qui écrit (SebaDB.create/update) déclenche elle-même
     persist() -> ne doit JAMAIS relancer une passe imbriquée ici -- le
     chaînage légitime (une action qui rend un nouvel événement détectable)
     est géré par l'appel récursif borné DANS runAutomationsPass(), jamais
     par ce hook. */
  let _automationPassRunning = false;
  SebaDB.onChange(function () {
    if (_automationPassRunning) return;
    _automationPassRunning = true;
    try { if (state) runAutomationsPass(state); } catch (e) { /* jamais interrompre l'app pour une erreur d'automatisation */ }
    finally { _automationPassRunning = false; }
  });

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
    // Parcours pilote complet (feature/pilot-ready-v1)
    buildBusinessObjectHref, getLinkedBusinessObjects, findExistingConversion,
    getBusinessNextActions, buildClientOperationalTimeline,
    // Espace commercial flexible (feature/flexible-commercial-documents)
    buildCommercialDocumentTotals, buildQuoteDocumentModel, buildInvoiceDocumentModel,
    buildReceiptDocumentModel, buildCommercialDocumentFilename, getCommercialDocumentValidation,
    COMMERCIAL_LINE_TYPES, COMMERCIAL_LINE_UNITS,
  };

  SebaDB.ready();
})();
