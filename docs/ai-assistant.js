/* ═══════════════════════════════════════════════════════════════
   SEBA — Assistant IA conversationnel du dashboard.

   Trois moteurs, bascule automatique dans cet ordre :
   1. RELAIS SUPABASE (supabase-functions/ai-relay.ts) — vraie IA pour
      TOUT LE MONDE connecté sur le site en ligne, sans qu'aucune clé
      secrète ne transite côté navigateur. Le relais essaie lui-même
      Mistral → Groq → OpenRouter → Gemini en cascade côté serveur.
      C'est le chemin normal une fois la fonction déployée (voir
      MANUEL-SEBA-ADMIN.md §1b).
   2. GROQ DIRECT (config.js → groqApiKey, local uniquement) — utile
      en développement avant d'avoir déployé le relais.
   3. ANALYSTE LOCAL — réponses générées depuis les vraies données
      (jour le plus chargé, impayés, devis à relancer, CA), zéro
      réseau, zéro clé. Toujours le dernier repli, ne peut pas échouer.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const cfg = window.SEBA_CONFIG || {};
  const groqKey = (cfg.groqApiKey && !/^VOTRE_/.test(cfg.groqApiKey)) ? cfg.groqApiKey : null;
  const GROQ_MODEL = cfg.groqModel || 'llama-3.1-8b-instant';
  const relayUrl = cfg.supabaseUrl ? cfg.supabaseUrl + '/functions/v1/ai-relay' : null;

  /* Jeton de session réel (posé par supabase-js) — le relais exige un
     vrai auth.uid() pour compter le quota par compte ; sans session
     (mode démo), il n'y a pas de jeton et l'appel échoue proprement
     (401), ce qui fait retomber la cascade sur l'analyste local. */
  function sessionBearer() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k)) {
          const tok = JSON.parse(localStorage.getItem(k));
          if (tok && tok.access_token) return tok.access_token;
        }
      }
    } catch (e) {}
    return null;
  }

  /* ── Résumé JSON des données réelles (contexte pour l'IA) ── */
  function businessContext() {
    if (!window.SebaDB || !SebaDB.hasData()) return null;
    const m = SebaDB.metrics();
    const interventions = SebaDB.list('interventions');
    const perDay = {};
    interventions.forEach(i => {
      const d = new Date(i.date).toLocaleDateString('fr-FR', { weekday: 'long' });
      perDay[d] = (perDay[d] || 0) + 1;
    });
    const busiest = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0] || null;
    const retard = SebaDB.list('factures').filter(f => f.status === 'retard');
    return {
      caMoisEUR: m.caMois, caTotalEUR: m.caTotal,
      clientsActifs: m.clientsActifs, clientsTotal: m.clientsTotal,
      devisEnAttente: m.devisAttente,
      facturesEnRetard: retard.length,
      montantEnRetardEUR: retard.reduce((s, f) => s + (f.amount || 0), 0),
      interventionsCeMois: m.interventionsMois,
      interventionsAujourdhui: m.interventionsJour.length,
      jourLePlusCharge: busiest ? busiest[0] + ' (' + busiest[1] + ' interventions)' : null,
    };
  }

  /* ── Moteur local (sans clé) : analyste à base de règles ── */
  function localAnalyst(question) {
    const ctx = businessContext();
    if (!ctx) return "Je n'ai pas encore de données à analyser — créez votre espace via l'inscription, ou ajoutez vos premiers clients et devis.";
    const q = question.toLowerCase();
    const bits = [];
    if (/ca|chiffre|argent|revenu|gagn/.test(q)) {
      bits.push('Votre CA encaissé ce mois est de **' + ctx.caMoisEUR + ' €** (total encaissé : ' + ctx.caTotalEUR + ' €).');
      if (ctx.devisEnAttente) bits.push('Vous avez ' + ctx.devisEnAttente + ' devis en attente — les signer est le levier le plus rapide pour augmenter ce chiffre.');
    }
    if (/retard|impay|relance|factur/.test(q) && ctx.facturesEnRetard) {
      bits.push('⚠️ ' + ctx.facturesEnRetard + ' facture(s) en retard pour ' + ctx.montantEnRetardEUR + ' € — relancez-les depuis la page Factures.');
    }
    if (/charge|embauche|planning|organis|jour/.test(q) && ctx.jourLePlusCharge) {
      bits.push('Votre jour le plus chargé est ' + ctx.jourLePlusCharge + '. Si la tendance se confirme, renforcez l\'équipe ce jour-là.');
    }
    if (/client/.test(q)) {
      bits.push('Vous avez ' + ctx.clientsActifs + ' clients actifs sur ' + ctx.clientsTotal + '. Les clients « en attente » sont vos conversions les plus faciles.');
    }
    if (!bits.length) {
      bits.push('Vue d\'ensemble : ' + ctx.caMoisEUR + ' € encaissés ce mois, ' + ctx.interventionsCeMois + ' interventions, ' +
        ctx.clientsActifs + ' clients actifs, ' + ctx.devisEnAttente + ' devis en attente' +
        (ctx.facturesEnRetard ? ', et ' + ctx.facturesEnRetard + ' facture(s) en retard (' + ctx.montantEnRetardEUR + ' €) à relancer en priorité.' : '.'));
      if (ctx.jourLePlusCharge) bits.push('Jour le plus chargé : ' + ctx.jourLePlusCharge + '.');
    }
    bits.push('_Mode analyste local — branchez une clé Groq dans config.js pour des réponses IA complètes._');
    return bits.join('\n\n');
  }

  /* ── Moteur Groq (clé configurée) ── */
  async function groqAnswer(question) {
    const ctx = businessContext();
    const system = 'Tu es l\'assistant business de Seba, un logiciel de gestion pour entreprises de services. ' +
      'Réponds en français, concis (max 120 mots), concret et actionnable, au patron de l\'entreprise. ' +
      (ctx ? 'Données réelles actuelles de son entreprise : ' + JSON.stringify(ctx) : 'Aucune donnée disponible pour le moment.');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: question }],
        max_tokens: 400, temperature: 0.4,
      }),
    });
    if (!res.ok) throw new Error('API Groq : HTTP ' + res.status);
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message.content) || 'Réponse vide.';
  }

  /* Appel du relais Supabase (cascade Mistral/Groq/OpenRouter/Gemini,
     clés cachées côté serveur — voir supabase-functions/ai-relay.ts) */
  async function relayAnswer(question) {
    const bearer = sessionBearer();
    if (!bearer) throw new Error('Aucune session active');
    const ctx = businessContext();
    const res = await fetch(relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + bearer },
      body: JSON.stringify({ mode: 'chat', question, context: ctx }),
    });
    if (!res.ok) throw new Error('Relais HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.answer;
  }

  let _relayDown = false; // évite de retenter à chaque message si la fonction n'est pas déployée

  window.askAI = async function (question) {
    if (relayUrl && !_relayDown) {
      try { return await relayAnswer(question); }
      catch (e) { _relayDown = true; /* on retente au prochain rechargement de page */ }
    }
    if (groqKey) {
      try { return await groqAnswer(question); }
      catch (e) { return localAnalyst(question) + '\n\n_(API Groq indisponible : ' + e.message + ' — repli local.)_'; }
    }
    return localAnalyst(question);
  };

  /* Diagnostic (utile pour vérifier quel moteur répond réellement) */
  window.sebaAIStatus = async function () {
    if (relayUrl) {
      try { await relayAnswer('ping'); return 'relais Supabase (cascade Mistral/Groq/OpenRouter/Gemini)'; }
      catch (e) { /* continue */ }
    }
    if (groqKey) return 'Groq direct (clé locale, dev uniquement)';
    return 'analyste local (aucune IA générative)';
  };

  /* ═══════════ Interface de chat ═══════════ */
  const css = document.createElement('style');
  css.textContent =
    '.ai-chat-fab{position:fixed;bottom:28px;left:28px;width:52px;height:52px;border-radius:50%;background:var(--white,#fff);border:1.5px solid var(--border,#E8E6E1);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.25rem;box-shadow:0 4px 20px rgba(0,0,0,.14);z-index:300;transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .2s;}' +
    '.ai-chat-fab:hover{transform:scale(1.08);box-shadow:0 0 0 3px rgba(0,200,150,.15),0 6px 24px rgba(0,0,0,.18);}' +
    '.ai-chat-panel{position:fixed;bottom:92px;left:28px;width:340px;max-width:calc(100vw - 40px);max-height:60vh;background:rgba(255,255,255,.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--border,#E8E6E1);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.18);z-index:301;display:none;flex-direction:column;overflow:hidden;}' +
    '.ai-chat-panel.open{display:flex;animation:aiPanelIn .22s cubic-bezier(0,0,.2,1) both;}' +
    '@keyframes aiPanelIn{from{opacity:0;transform:translateY(12px) scale(.97);}to{opacity:1;transform:none;}}' +
    '.ai-chat-head{padding:13px 16px;border-bottom:1px solid var(--border,#E8E6E1);font-weight:700;font-size:.9rem;display:flex;align-items:center;gap:8px;}' +
    '.ai-chat-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:120px;}' +
    '.ai-msg{max-width:85%;padding:9px 13px;border-radius:12px;font-size:.84rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;}' +
    '.ai-msg.user{align-self:flex-end;background:var(--ink,#14161A);color:#fff;border-bottom-right-radius:4px;}' +
    '.ai-msg.bot{align-self:flex-start;background:var(--bg,#FAF9F7);border:1px solid var(--border,#E8E6E1);border-bottom-left-radius:4px;}' +
    '.ai-typing{align-self:flex-start;font-size:1rem;color:var(--text-2,#6B6A6F);padding:2px 8px;letter-spacing:2px;animation:aiBlink 1s infinite;}' +
    '@keyframes aiBlink{50%{opacity:.35;}}' +
    '.ai-chat-input{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border,#E8E6E1);}' +
    '.ai-chat-input input{flex:1;border:1.5px solid var(--border,#E8E6E1);border-radius:9px;padding:9px 12px;font-family:inherit;font-size:.85rem;outline:none;}' +
    '.ai-chat-input input:focus{border-color:var(--emerald,#00C896);}' +
    '.ai-chat-input button{background:var(--emerald,#00C896);color:var(--ink,#14161A);border:none;border-radius:9px;padding:0 16px;font-weight:700;cursor:pointer;font-size:.85rem;}';
  document.head.appendChild(css);

  const fab = document.createElement('button');
  fab.className = 'ai-chat-fab';
  fab.setAttribute('aria-label', 'Ouvrir l\'assistant IA');
  fab.title = 'Assistant IA Seba';
  fab.textContent = '🤖';
  const panel = document.createElement('div');
  panel.className = 'ai-chat-panel';
  panel.innerHTML =
    '<div class="ai-chat-head">🤖 Assistant Seba <span id="ai-engine-badge" style="margin-left:auto;font-size:.68rem;font-weight:500;color:var(--text-2,#6B6A6F);">' + (relayUrl ? '…' : (groqKey ? 'IA Groq (locale)' : 'analyste local')) + '</span></div>' +
    '<div class="ai-chat-msgs" id="ai-chat-msgs">' +
    '<div class="ai-msg bot">Bonjour ! Posez-moi une question sur votre activité : « Comment va mon CA ? », « Quelles factures relancer ? », « Quel est mon jour le plus chargé ? »…</div>' +
    '</div>' +
    '<div class="ai-chat-input"><input id="ai-chat-inp" type="text" placeholder="Votre question…" aria-label="Question à l\'assistant"><button id="ai-chat-send">→</button></div>';
  document.body.appendChild(fab);
  document.body.appendChild(panel);

  if (relayUrl) {
    window.sebaAIStatus().then((label) => {
      const badge = document.getElementById('ai-engine-badge');
      if (badge) badge.textContent = /relais/.test(label) ? 'IA Groq' : (/direct/.test(label) ? 'IA Groq (locale)' : 'analyste local');
    });
  }

  fab.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) document.getElementById('ai-chat-inp').focus();
  });

  async function send() {
    const inp = document.getElementById('ai-chat-inp');
    const q = inp.value.trim();
    if (!q) return;
    inp.value = '';
    const msgs = document.getElementById('ai-chat-msgs');
    const user = document.createElement('div');
    user.className = 'ai-msg user';
    user.textContent = q;
    msgs.appendChild(user);
    const typing = document.createElement('div');
    typing.className = 'ai-typing';
    typing.textContent = '●●●';
    msgs.appendChild(typing);
    msgs.scrollTop = msgs.scrollHeight;
    const answer = await window.askAI(q);
    typing.remove();
    const bot = document.createElement('div');
    bot.className = 'ai-msg bot';
    msgs.appendChild(bot);
    /* effet machine à écrire */
    let i = 0;
    const clean = answer.replace(/\*\*/g, '').replace(/_/g, '');
    (function type() {
      bot.textContent = clean.slice(0, i);
      msgs.scrollTop = msgs.scrollHeight;
      i += 3;
      if (i <= clean.length + 2) setTimeout(type, 12);
    })();
  }
  document.getElementById('ai-chat-send').addEventListener('click', send);
  document.getElementById('ai-chat-inp').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
})();
