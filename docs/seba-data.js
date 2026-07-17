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
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const DB_KEY = 'seba_db';
  const EMPTY = () => ({
    v: 1,
    clients: [], devis: [], factures: [], interventions: [], employes: [], journal: [],
    custom_services: [], contrats: [], messages: [],
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
