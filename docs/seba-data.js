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
     SebaDB.setEmployePin(employeId, pin)       -> async, Edge Function employe-set-pin.ts
     SebaDB.employeLogin(employeId, pin)        -> async, Edge Function employe-auth.ts, pose la session terrain
     SebaDB.employeSession() / employeLogout()  -> lecture/effacement de la session terrain locale
     SebaDB.clientPortal.signup/login/logout/session/profile()  -> async, vraie session Supabase Auth independante (RPC link_client_account/get_my_client_profile)
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

  /* ═══════════ File de patchs delta + worker de synchro (Palier 1) ═══════
     N'existe que si Supabase est configure (hasSupabase) : en mode local
     pur, pushOp() est un no-op immediat, aucune cle localStorage
     supplementaire n'est meme ecrite. */
  const PENDING_KEY = 'seba_pending_ops';
  const DEVICE_KEY = 'seba_device_id';
  const SEQ_KEY = 'seba_client_seq';
  const MAX_OP_ATTEMPTS = 5;

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
  }

  let _syncTimer = null;
  let _syncing = false;
  function scheduleSyncWorker() {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(syncWorker, 800); // meme debounce que l'ancien push blob, comportement percu inchange
  }

  /* Vide seba_pending_ops vers sync-push.ts par lots. Idempotent cote
     serveur (unique(account, device_id, client_seq)) : rejouer le meme
     lot apres une coupure ne duplique jamais rien, donc aucune precaution
     particuliere n'est necessaire ici en cas de double declenchement. */
  async function syncWorker() {
    if (_syncing) return;
    const cfg = window.SEBA_CONFIG;
    if (!hasSupabase || !SupabaseAdapter._hasSession(cfg)) return; // mode demo/anonyme : rien a synchroniser
    const queue = loadQueue();
    if (!queue.length) return;

    _syncing = true;
    try {
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
        console.warn('[seba-data] sync-push en echec (HTTP ' + res.status + ') — la file reste intacte, re-essai plus tard.');
        return;
      }
      const body = await res.json();
      const results = (body && body.results) || [];
      const acked = new Set(results.filter(r => r.status === 'applied' || r.status === 'ack_duplicate').map(r => r.client_seq));
      const errored = new Set(results.filter(r => r.status === 'error').map(r => r.client_seq));

      const remaining = queue
        .filter(o => !acked.has(o.client_seq))
        .map(o => errored.has(o.client_seq) ? Object.assign({}, o, { attempts: o.attempts + 1 }) : o)
        .filter(o => {
          if (o.attempts > MAX_OP_ATTEMPTS) {
            console.error('[seba-data] operation abandonnee apres ' + MAX_OP_ATTEMPTS + ' echecs (' + o.entity + '/' + o.entity_id + '), retiree de la file.', o);
            return false;
          }
          return true;
        });
      saveQueue(remaining);
      if (remaining.length) scheduleSyncWorker(); // ops restantes (erreurs recuperables) : re-essai differe, pas de boucle serree
    } catch (e) {
      console.warn('[seba-data] sync-push impossible (reseau) — la file reste intacte, re-essai a la prochaine ecriture ou reconnexion.', e.message);
    } finally {
      _syncing = false;
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { if (hasSupabase) scheduleSyncWorker(); });
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
      }
      return state;
    },

    hasData() { if (!state) loadState(); return state.clients.length > 0; },

    list(coll) { if (!state) loadState(); return (state[coll] || []).slice(); },
    get(coll, id) { if (!state) loadState(); return (state[coll] || []).find(x => x.id === id) || null; },

    create(coll, obj) {
      if (!state) loadState();
      const item = Object.assign({ id: uid(), createdAt: todayISO(0) }, obj);
      state[coll].unshift(item);
      persist();
      pushOp(coll, item.id, 'create', item); // patch = objet complet, rien a fusionner cote serveur pour une creation
      return item;
    },
    update(coll, id, patch) {
      if (!state) loadState();
      const item = (state[coll] || []).find(x => x.id === id);
      if (item) {
        Object.assign(item, patch);
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
          (!filter || !filter.employeId || m.employeId === filter.employeId)
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

    /* Definit/change le PIN terrain (4 chiffres) d'un employe. Chemin
       Supabase : appelle l'Edge Function employe-set-pin.ts (service_role),
       car employe_credentials n'a AUCUNE policy RLS -- pin_hash ne doit
       jamais transiter par le REST public, meme proprietaire du compte
       (voir supabase-schema.sql section 10a). Repli local (file://, pas
       de session) : stocke le PIN EN CLAIR sur l'employe local -- honnete
       pour du mode demo sans backend, jamais utilise si Supabase est
       configure et une session existe. Retourne {ok:true} ou {ok:false,
       error}. */
    async setEmployePin(employeId, pin, opts) {
      if (!state) loadState();
      if (!/^\d{4}$/.test(pin || '')) return { ok: false, error: 'Le PIN doit contenir 4 chiffres.' };
      const emp = state.employes.find(e => e.id === employeId);
      if (!emp) return { ok: false, error: 'Employé introuvable.' };
      // pinIsDefault : marqueur non-secret (jamais le PIN lui-meme) --
      // true uniquement quand equipe.html pose le code de depart '1234' a
      // la creation (opts.isDefault). Un changement ulterieur (par
      // l'employe depuis l'espace terrain, ou une reinitialisation par le
      // patron) passe toujours opts.isDefault a false/absent, meme si le
      // nouveau code choisi est accidentellement '1234' -- ce n'est plus
      // LE code de depart connu de tous, c'est un choix explicite.
      const isDefault = !!(opts && opts.isDefault);
      if (hasSupabase && adapter._hasSession(window.SEBA_CONFIG)) {
        try {
          const cfg = window.SEBA_CONFIG;
          const res = await fetch(cfg.supabaseUrl + '/functions/v1/employe-set-pin', {
            method: 'POST',
            headers: adapter._headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ account: adapter._accountId(), employe_id: employeId, pin }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) return { ok: false, error: body.error || ('Erreur serveur (HTTP ' + res.status + ')') };
          emp.pinSet = true;
          emp.pinIsDefault = isDefault;
          persist();
          pushOp('employes', employeId, 'update', { pinSet: true, pinIsDefault: isDefault });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: 'Connexion impossible : ' + e.message };
        }
      }
      emp.pinLocal = pin; // clair, mode demo/file:// uniquement -- jamais le chemin utilisé une fois Supabase configuré
      emp.pinSet = true;
      emp.pinIsDefault = isDefault;
      persist();
      return { ok: true };
    },

    /* Badge un employé sur l'appareil (employe-connexion.html), PIN 4
       chiffres verifie contre setEmployePin() ci-dessus. Chemin Supabase :
       appelle l'Edge Function employe-auth.ts (deja deployee/documentee,
       verifie le PIN cote serveur via pin_hash -- jamais transmis au
       client), stocke le token de session retourne. Repli local : compare
       au pinLocal en clair pose par setEmployePin() en mode demo/file://.
       Dans les deux cas, persiste la session dans localStorage sous
       seba_employee_token (deja lu par syncWorker/sync-push plus haut) et
       seba_employee_active (identite affichee par l'espace terrain). */
    async employeLogin(employeId, pin) {
      if (!state) loadState();
      if (!/^\d{4}$/.test(pin || '')) return { ok: false, error: 'Le PIN doit contenir 4 chiffres.' };
      const emp = state.employes.find(e => e.id === employeId);
      if (!emp) return { ok: false, error: 'Employé introuvable.' };

      if (hasSupabase && adapter._hasSession(window.SEBA_CONFIG)) {
        try {
          const cfg = window.SEBA_CONFIG;
          const res = await fetch(cfg.supabaseUrl + '/functions/v1/employe-auth', {
            method: 'POST',
            headers: adapter._headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ account: adapter._accountId(), employe_id: employeId, pin, device_id: getDeviceId() }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) return { ok: false, error: body.error || 'Identifiants invalides.' };
          try {
            localStorage.setItem('seba_employee_token', body.token);
            localStorage.setItem('seba_employee_active', JSON.stringify({ id: emp.id, prenom: emp.prenom, nom: emp.nom, expiresAt: body.expires_at }));
          } catch (e) {}
          return { ok: true, employe: emp };
        } catch (e) {
          return { ok: false, error: 'Connexion impossible : ' + e.message };
        }
      }

      if (emp.pinLocal !== pin) return { ok: false, error: 'PIN incorrect.' };
      try {
        const expiresAt = new Date(Date.now() + 7 * 24 * 3600e3).toISOString(); // 7 jours, mode demo/file:// uniquement
        localStorage.setItem('seba_employee_token', 'local-' + uid());
        localStorage.setItem('seba_employee_active', JSON.stringify({ id: emp.id, prenom: emp.prenom, nom: emp.nom, expiresAt }));
      } catch (e) {}
      return { ok: true, employe: emp };
    },

    /* État de badge courant (lu par l'espace terrain) -- null si aucune
       session employé active ou expirée. Ne vérifie jamais le token côté
       serveur ici (juste sa présence/fraîcheur locale) : toute requête
       Supabase réelle (X-Employee-Token) est de toute façon revalidée
       côté serveur, cette fonction ne sert qu'à l'affichage. */
    employeSession() {
      try {
        const raw = localStorage.getItem('seba_employee_active');
        if (!raw) return null;
        const active = JSON.parse(raw);
        if (active.expiresAt && new Date(active.expiresAt) < new Date()) {
          localStorage.removeItem('seba_employee_active');
          localStorage.removeItem('seba_employee_token');
          return null;
        }
        return active;
      } catch (e) { return null; }
    },

    employeLogout() {
      try {
        localStorage.removeItem('seba_employee_active');
        localStorage.removeItem('seba_employee_token');
      } catch (e) {}
    },

    /* ── Espace Client (2026-07-19) ──────────────────────────────────────
       Seul acteur avec une VRAIE session Supabase Auth independante
       (contrairement a l'employe, badge sur l'appareil du patron -- voir
       employeLogin ci-dessus). Reutilise sebaAuth.signUp/signIn (deja
       generiques, pas specifiques au patron) pour la vraie session, MAIS
       jamais sebaAuth's DEMO_KEY partage en mode demo : un patron et un
       client "connectes" en demo sur le meme navigateur se marcheraient
       dessus sinon. seba_client_session_demo est une cle distincte.
       Rattachement compte<->fiche existante : RPC link_client_account
       (recherche cross-tenant par email, SECURITY DEFINER cote serveur --
       voir supabase-schema.sql section 33) ; en demo, meme recherche mais
       100% locale (state.clients). ── */
    clientPortal: {
      async signup(email, password) {
        email = (email || '').trim().toLowerCase();
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.signUp(email, password);
          if (!res.ok) return res;
          if (res.needsConfirm) return { ok: true, needsConfirm: true };
          const link = await sebaAuth.rpc('link_client_account', { _email: email });
          if (link.error) return { ok: false, error: link.error.message || 'Erreur de rattachement.' };
          if (!link.data || !link.data.ok) return { ok: false, error: (link.data && link.data.error) || 'Aucune fiche trouvée.' };
          return { ok: true };
        }
        if (!state) loadState();
        const client = state.clients.find(c => (c.email || '').trim().toLowerCase() === email);
        if (!client) return { ok: false, error: 'Aucune fiche client trouvée avec cet email. Contactez votre prestataire.' };
        try { localStorage.setItem('seba_client_session_demo', JSON.stringify({ email, clientId: client.id })); } catch (e) {}
        return { ok: true };
      },

      async login(email, password) {
        email = (email || '').trim().toLowerCase();
        if (hasSupabase && window.sebaAuth && sebaAuth.isConfigured) {
          const res = await sebaAuth.signIn(email, password);
          if (!res.ok) return res;
          // Rattache si pas deja fait (ex: confirmation email differee au
          // signup) -- idempotent, already_linked:true sinon.
          const link = await sebaAuth.rpc('link_client_account', { _email: email });
          if (link.data && !link.data.ok) return { ok: false, error: link.data.error };
          return { ok: true };
        }
        return SebaDB.clientPortal.signup(email, password); // demo : meme recherche, pas de vrai mot de passe a verifier
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

      /* Demandes ("Nouvelle demande", client-espace.html). Accessible cote
         client (ses propres demandes) ET cote patron (client-fiche.html --
         RLS client_requests_select autorise les deux, voir schema). */
      requests: {
        /* account optionnel : un client fournit toujours le sien (via
           clientPortal.profile().account, distinct de son propre
           auth.uid()) ; le patron peut l'omettre, il retombe alors sur
           adapter._accountId() (correct pour LUI -- meme defaut que
           messages.send/list plus haut). */
        async list(account, clientId) {
          if (hasSupabase && adapter._hasSession(window.SEBA_CONFIG)) {
            try {
              const cfg = window.SEBA_CONFIG;
              account = account || adapter._accountId();
              const url = cfg.supabaseUrl + '/rest/v1/client_requests?account=eq.' + encodeURIComponent(account) + '&client_id=eq.' + encodeURIComponent(clientId) + '&order=created_at.desc';
              const res = await fetch(url, { headers: adapter._headers() });
              if (res.ok) {
                const rows = await res.json();
                return rows.map(r => ({
                  id: r.id, clientId: r.client_id, titre: r.titre, statut: r.statut,
                  intervenantId: r.intervenant_id, intervenantNom: r.intervenant_nom, createdAt: r.created_at,
                }));
              }
              console.warn('[seba-data] lecture demandes distante en echec (HTTP ' + res.status + ') — repli local.');
            } catch (e) { console.warn('[seba-data] lecture demandes distante impossible (reseau)', e.message); }
          }
          if (!state) loadState();
          return state.clientRequests.filter(r => r.clientId === clientId);
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
          const item = { id: uid(), clientId, titre, statut: 'nouvelle', intervenantId: null, intervenantNom: null, createdAt: todayISO(0) };
          state.clientRequests.unshift(item);
          persist();
          return item;
        },
        /* Cote patron uniquement (client-fiche.html) : assigner un
           intervenant / changer le statut. RLS client_requests_update
           n'autorise que le proprietaire du compte (voir schema). */
        async update(requestId, patch) {
          if (hasSupabase && adapter._hasSession(window.SEBA_CONFIG)) {
            try {
              const cfg = window.SEBA_CONFIG;
              const body = {};
              if (patch.statut !== undefined) body.statut = patch.statut;
              if (patch.intervenantId !== undefined) body.intervenant_id = patch.intervenantId;
              if (patch.intervenantNom !== undefined) body.intervenant_nom = patch.intervenantNom;
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
       employe_credentials/employe_sessions, non purgees ici. */
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
  };

  window.SebaDB = SebaDB;
  SebaDB.ready();
})();
