/* ═══════════════════════════════════════════════════════════════
   SEBA DATA ENGINE — couche de données unifiée du site pro.
   Une seule source de vérité pour clients, devis, factures,
   interventions, employés et journal d'activité.

   Architecture en adaptateurs :
   - LocalAdapter (défaut)   : localStorage['seba_db'], zéro dépendance.
   - SupabaseAdapter (option): activé si window.SEBA_CONFIG.supabaseUrl
     et .supabaseAnonKey sont définis (voir docs-backend.md). Persiste
     l'état côté cloud → multi-appareils. Le reste du code ne change pas.

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
     SebaDB.hasData()                  -> vrai si le compte a des données
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const DB_KEY = 'seba_db';
  const EMPTY = () => ({
    v: 1,
    clients: [], devis: [], factures: [], interventions: [], employes: [], journal: [],
    seq: { devis: 118, facture: 93 },
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
    async pull() {
      const cfg = window.SEBA_CONFIG;
      try {
        const res = await fetch(cfg.supabaseUrl + '/rest/v1/seba_state?select=state&account=eq.' + encodeURIComponent(cfg.accountId || 'default'), {
          headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey },
        });
        if (!res.ok) return null;
        const rows = await res.json();
        return rows.length ? rows[0].state : null;
      } catch (e) { return null; }
    },
    save(state) {
      LocalAdapter.save(state); // cache local toujours à jour
      clearTimeout(this._pending);
      this._pending = setTimeout(() => this._push(state), 800);
    },
    async _push(state) {
      const cfg = window.SEBA_CONFIG;
      try {
        await fetch(cfg.supabaseUrl + '/rest/v1/seba_state', {
          method: 'POST',
          headers: {
            apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey,
            'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify({ account: cfg.accountId || 'default', state, updated_at: new Date().toISOString() }),
        });
      } catch (e) { /* offline : le cache local fait foi, re-push à la prochaine écriture */ }
    },
  };

  const hasSupabase = !!(window.SEBA_CONFIG && window.SEBA_CONFIG.supabaseUrl && window.SEBA_CONFIG.supabaseAnonKey);
  const adapter = hasSupabase ? SupabaseAdapter : LocalAdapter;

  let state = null;
  const listeners = [];

  function loadState() {
    state = adapter.load() || EMPTY();
    if (!state.seq) state.seq = { devis: 118, facture: 93 };
    return state;
  }
  function persist() {
    adapter.save(state);
    listeners.forEach(fn => { try { fn(); } catch (e) {} });
  }
  function uid() { return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
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
      return item;
    },
    update(coll, id, patch) {
      if (!state) loadState();
      const item = (state[coll] || []).find(x => x.id === id);
      if (item) { Object.assign(item, patch); persist(); }
      return item;
    },
    remove(coll, id) {
      if (!state) loadState();
      state[coll] = (state[coll] || []).filter(x => x.id !== id);
      persist();
    },

    nextNum(kind) {
      if (!state) loadState();
      if (kind === 'facture') return '#F-' + String(++state.seq.facture).padStart(4, '0');
      return '#' + String(++state.seq.devis).padStart(4, '0');
    },

    log(type, label, href) {
      if (!state) loadState();
      state.journal.unshift({ id: uid(), ts: Date.now(), type, label, href: href || '#' });
      if (state.journal.length > 200) state.journal.length = 200;
      persist();
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
        interventionsJour: state.interventions.filter(i => i.date === today).sort((a, b) => a.time.localeCompare(b.time)),
      };
    },

    onChange(fn) {
      listeners.push(fn);
      // synchro entre onglets
      window.addEventListener('storage', e => { if (e.key === DB_KEY) { state = null; loadState(); fn(); } });
    },

    exportJSON() { if (!state) loadState(); return JSON.stringify(state, null, 2); },
    importJSON(str) {
      const parsed = JSON.parse(str); // laisse remonter l'erreur si invalide
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.clients)) throw new Error('Format de sauvegarde invalide');
      state = Object.assign(EMPTY(), parsed);
      persist();
    },

    _reset() { state = EMPTY(); persist(); },
  };

  window.SebaDB = SebaDB;
  SebaDB.ready();
})();
