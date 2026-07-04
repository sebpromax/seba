/* ═══════════════════════════════════════════════════════════════
   SEBA — Moteur de widgets du dashboard
   Catalogue, grille, persistance de layout, moteur de règles
   "compagnon", et matching de la barre de commande IA (simulée).
   Chargé par dashboard.html après businessTypes.js.
═══════════════════════════════════════════════════════════════ */

/* ── Stockage (même forme que le SebaStorage copié-collé dans
   les pages-outils : préfixe 'seba_' + JSON) ── */
function readSeba(key, fallback) {
  try {
    const d = localStorage.getItem('seba_' + key);
    return d ? JSON.parse(d) : (fallback !== undefined ? fallback : null);
  } catch (e) { return fallback !== undefined ? fallback : null; }
}
function writeSeba(key, val) {
  try { localStorage.setItem('seba_' + key, JSON.stringify(val)); } catch (e) {}
}

const SebaLayoutStore = {
  KEY: 'dashboard_layout',
  read() { return readSeba(this.KEY, null); },
  write(layout) { layout.updatedAt = new Date().toISOString(); writeSeba(this.KEY, layout); },
};

function parseFrDate(str) {
  if (!str) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str.trim());
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}
function daysSince(date) {
  if (!date) return 0;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

/* ═══════════════════════════════════════════════════════════════
   CONTEXTE — construit une fois par rendu, regroupe DEMO du secteur
   + données réelles des pages-outils (creances, RH, pipeline, tournée)
═══════════════════════════════════════════════════════════════ */
function buildWidgetCtx({ biz, demo, secteur, sectorLabel, nom, couleur, services, slug, sym }) {
  return {
    biz, demo, secteur, sectorLabel, nom, couleur, services, slug, sym,
    creances: readSeba('creances_imp', []),
    rhEmployees: readSeba('rh_employees', []),
    rhPointages: readSeba('rh_pointages', []),
    mutationDocs: readSeba('mutation_docs', []),
    haversinePts: readSeba('haversine_pts', []),
  };
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS DE RENDU — bâtisseurs HTML réutilisés par plusieurs widgets
═══════════════════════════════════════════════════════════════ */
function buildMetricCardEl(m, secteur, seed) {
  const a = document.createElement('a');
  a.href = m.href;
  a.className = 'metric-card';
  a.innerHTML =
    '<div class="metric-label">' + m.label + '</div>' +
    '<div class="metric-value">' + m.value + '<span class="metric-unit">' + m.unit + '</span></div>' +
    '<div class="metric-delta ' + (m.up ? 'up' : 'down') + '">' + (m.up ? '↑' : '↓') + ' ' + m.delta + '</div>' +
    '<div class="metric-spark" aria-hidden="true"></div>';
  renderMetricSparkline(a.querySelector('.metric-spark'), secteur, seed || 0);
  return a;
}

function buildBentoChartHTML(goal, sym) {
  const cur = goal ? goal.current : 0;
  const tgt = goal ? goal.target : 0;
  if (cur <= 0) {
    return '<div class="bc-empty-body">' +
      '<div class="bc-empty-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00C896" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/></svg></div>' +
      '<div class="bc-empty-title">Prêt pour vos premiers encaissements</div>' +
      '<div class="bc-empty-sub">Vos revenus apparaîtront ici dès la création de votre première facture.</div>' +
      '<button class="bc-empty-btn" onclick="window.location.href=\'factures.html\'">+ Créer une demande de paiement</button>' +
      '</div>';
  }
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin'];
  const variance = [0.62, 0.71, 0.83, 0.90, 0.96, 1.0];
  const pts = variance.map(v => Math.round(cur * v));
  const delta = tgt > 0 ? Math.round((cur / tgt) * 100) : null;
  const deltaLabel = delta !== null ? (delta >= 100 ? '✓ Objectif atteint' : delta + '% de l\'objectif') : '+12% vs mois précédent';
  const W = 400, H = 72, PAD = 4;
  const maxV = Math.max(...pts);
  const coords = pts.map((v, i) => {
    const x = PAD + (i / (pts.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((v / maxV) * (H - PAD * 2));
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  const linePoints = coords.join(' ');
  const fillPoints = coords[0].split(',')[0] + ',' + H + ' ' + linePoints + ' ' + coords[coords.length - 1].split(',')[0] + ',' + H;
  const totalFmt = cur >= 1000 ? (cur / 1000).toFixed(1).replace('.', ',') + ' k' : cur.toString();
  const lastPt = coords[coords.length - 1].split(',');

  return '<div class="bc-hdr">' +
    '<div><div class="bc-amount">' + totalFmt + '<span class="bc-u">' + sym + '</span></div>' +
    '<div class="bc-delta-row"><span class="bc-delta up">↑ ' + deltaLabel + '</span></div></div>' +
    '<span style="font-size:.73rem;color:var(--text-2);">Ce mois · ' + new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) + '</span>' +
    '</div>' +
    '<div class="bc-svg-wrap">' +
    '<svg class="bc-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
    '<defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#00C896" stop-opacity="0.18"/><stop offset="100%" stop-color="#00C896" stop-opacity="0"/>' +
    '</linearGradient></defs>' +
    '<polygon points="' + fillPoints + '" fill="url(#chart-fill)"/>' +
    '<polyline class="chart-line-anim" points="' + linePoints + '" fill="none" stroke="#00C896" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="4" fill="#00C896" class="bc-dot"><title>' + totalFmt + ' ' + sym + '</title></circle>' +
    '</svg>' +
    '<div class="bc-months">' + months.map(m => '<span>' + m + '</span>').join('') + '</div>' +
    '</div>';
}

/* ── Série financière 6 mois par secteur (variance réaliste, pas une simple
   rampe linéaire) : creux saisonnier, reprise, accélération récente ── */
const SECTOR_VARIANCE = {
  menage:        [0.71, 0.66, 0.78, 0.84, 0.93, 1.0],
  conciergerie:  [0.55, 0.60, 0.74, 0.88, 0.95, 1.0],
  conciergerieCopro: [0.90, 0.92, 0.89, 0.94, 0.97, 1.0],
  conciergerieEntreprise: [0.78, 0.83, 0.80, 0.90, 0.94, 1.0],
  jardinage:     [0.42, 0.55, 0.79, 0.91, 0.96, 1.0],
  maintenance:   [0.83, 0.76, 0.88, 0.85, 0.94, 1.0],
  pressing:      [0.88, 0.91, 0.86, 0.93, 0.96, 1.0],
  beaute:        [0.69, 0.75, 0.82, 0.87, 0.92, 1.0],
  animaux:       [0.62, 0.70, 0.81, 0.90, 0.94, 1.0],
  demenagement:  [0.48, 0.57, 0.72, 0.86, 0.95, 1.0],
};
const CHART_MONTHS = ['Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil'];

function buildFinanceSeries(secteur, current) {
  const variance = SECTOR_VARIANCE[secteur] || [0.62, 0.71, 0.83, 0.90, 0.96, 1.0];
  return variance.map((v, i) => ({ month: CHART_MONTHS[i], value: Math.round(current * v) }));
}

/* ── Graphique financier D3 : courbe lissée, dégradé sous la courbe,
   tooltip interactif au survol/toucher, tracé animé. Fallback : sparkline
   SVG inline (buildBentoChartHTML) si D3 absent. ── */
function renderFinanceChartD3(wrapEl, series, sym) {
  if (typeof d3 === 'undefined' || !wrapEl) return false;
  const W = 400, H = 96, PAD = { top: 8, right: 8, bottom: 4, left: 8 };
  wrapEl.innerHTML = '';
  const svg = d3.select(wrapEl).append('svg')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'none')
    .style('width', '100%').style('display', 'block').style('overflow', 'visible');

  const x = d3.scalePoint().domain(series.map(d => d.month)).range([PAD.left, W - PAD.right]);
  const maxV = d3.max(series, d => d.value);
  const y = d3.scaleLinear().domain([0, maxV * 1.08]).range([H - PAD.bottom, PAD.top]);

  const defs = svg.append('defs');
  const grad = defs.append('linearGradient').attr('id', 'd3-fin-fill').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#00C896').attr('stop-opacity', 0.22);
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#00C896').attr('stop-opacity', 0);

  const area = d3.area().x(d => x(d.month)).y0(H - PAD.bottom).y1(d => y(d.value)).curve(d3.curveCatmullRom.alpha(0.6));
  const line = d3.line().x(d => x(d.month)).y(d => y(d.value)).curve(d3.curveCatmullRom.alpha(0.6));

  svg.append('path').datum(series).attr('d', area).attr('fill', 'url(#d3-fin-fill)').attr('opacity', 0)
    .transition().duration(900).delay(350).attr('opacity', 1);

  const path = svg.append('path').datum(series).attr('d', line)
    .attr('fill', 'none').attr('stroke', '#00C896').attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
  const len = path.node().getTotalLength();
  path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
    .transition().duration(1200).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);

  const last = series[series.length - 1];
  svg.append('circle').attr('cx', x(last.month)).attr('cy', y(last.value)).attr('r', 4)
    .attr('fill', '#00C896').attr('opacity', 0)
    .transition().delay(1100).duration(300).attr('opacity', 1);

  /* Tooltip + crosshair interactifs */
  const focusDot = svg.append('circle').attr('r', 4.5).attr('fill', '#fff')
    .attr('stroke', '#00C896').attr('stroke-width', 2.5).style('display', 'none');
  const focusLine = svg.append('line').attr('stroke', 'rgba(0,200,150,.35)')
    .attr('stroke-dasharray', '3 3').attr('y1', PAD.top).attr('y2', H - PAD.bottom).style('display', 'none');

  const tip = document.createElement('div');
  tip.className = 'd3-fin-tip';
  tip.style.display = 'none';
  wrapEl.style.position = 'relative';
  wrapEl.appendChild(tip);

  function moveFocus(clientX) {
    const rect = wrapEl.getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width * W;
    let best = series[0], bd = Infinity;
    series.forEach(d => { const dist = Math.abs(x(d.month) - relX); if (dist < bd) { bd = dist; best = d; } });
    focusDot.attr('cx', x(best.month)).attr('cy', y(best.value)).style('display', null);
    focusLine.attr('x1', x(best.month)).attr('x2', x(best.month)).style('display', null);
    tip.style.display = 'block';
    tip.textContent = best.month + ' · ' + best.value.toLocaleString('fr-FR') + ' ' + sym;
    const px = x(best.month) / W * rect.width;
    tip.style.left = Math.min(Math.max(px, 44), rect.width - 44) + 'px';
    tip.style.top = (y(best.value) / H * rect.height - 34) + 'px';
  }
  function hideFocus() { focusDot.style('display', 'none'); focusLine.style('display', 'none'); tip.style.display = 'none'; }
  wrapEl.addEventListener('mousemove', e => moveFocus(e.clientX));
  wrapEl.addEventListener('mouseleave', hideFocus);
  wrapEl.addEventListener('touchmove', e => { if (e.touches[0]) moveFocus(e.touches[0].clientX); }, { passive: true });
  wrapEl.addEventListener('touchend', hideFocus);

  const months = document.createElement('div');
  months.className = 'bc-months';
  months.innerHTML = series.map(d => '<span>' + d.month + '</span>').join('');
  wrapEl.appendChild(months);
  return true;
}

/* Mini-sparkline D3 pour les metric cards (style terminal financier) */
function renderMetricSparkline(el, secteur, seed) {
  if (typeof d3 === 'undefined' || !el) return;
  const variance = SECTOR_VARIANCE[secteur] || [0.6, 0.7, 0.8, 0.9, 0.95, 1.0];
  const series = variance.map((v, i) => v * (1 + Math.sin(i * 2.1 + seed * 1.7) * 0.08));
  const W = 96, H = 26;
  const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`)
    .style('width', '100%').style('height', H + 'px').style('display', 'block');
  const x = d3.scaleLinear().domain([0, series.length - 1]).range([2, W - 2]);
  const y = d3.scaleLinear().domain([d3.min(series) * 0.96, d3.max(series) * 1.04]).range([H - 2, 2]);
  const line = d3.line().x((d, i) => x(i)).y(d => y(d)).curve(d3.curveCatmullRom.alpha(0.6));
  svg.append('path').datum(series).attr('d', line).attr('fill', 'none')
    .attr('stroke', 'rgba(0,200,150,.55)').attr('stroke-width', 1.6).attr('stroke-linecap', 'round');
}

const TYPE_PILL_LABEL = { intervention: 'Intervention', devis: 'Devis', client: 'Client', paiement: 'Paiement' };

function buildTimelineHTML(timeline) {
  if (!timeline.length) return '<div class="tl-empty">Aucune tâche planifiée. <a href="planning.html" style="color:var(--emerald)">Planifier →</a></div>';
  return timeline.map(t =>
    '<a href="' + t.href + '" class="tl-item' + (t.done ? ' done' : '') + '">' +
    '<div class="tl-time-col"><span class="tl-time">' + t.time + '</span><div class="tl-dot' + (t.done ? ' done' : '') + '"></div></div>' +
    '<div><div class="tl-type-pill ' + t.type + '">' + (TYPE_PILL_LABEL[t.type] || t.type) + '</div>' +
    '<div class="tl-label">' + t.label + '</div>' +
    '<div class="tl-sub">' + t.sub + '</div></div></a>'
  ).join('');
}

function buildActivityHTML(activity) {
  return activity.map(item =>
    '<a href="' + item.href + '" class="activity-item">' +
    '<div class="act-dot ' + item.type + '"></div>' +
    '<div class="act-body"><div class="act-label">' + item.label + '</div>' +
    '<div class="act-time">' + item.time + '</div></div></a>'
  ).join('');
}

function buildRecoItemHTML(r) {
  return '<a href="' + r.href + '" class="reco-item">' +
    '<div class="reco-bar ' + r.cls + '"></div>' +
    '<div class="reco-content"><div class="reco-title">' + r.title + '</div>' +
    '<div class="reco-desc">' + r.desc + '</div>' +
    '<div class="reco-cta">' + r.cta + ' →</div></div></a>';
}

function buildTeamItemEl(t, couleur) {
  const a = document.createElement('a');
  a.href = t.href || 'equipe.html';
  a.className = 'team-item';
  const initials = t.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const avBg = t.working ? couleur : 'var(--border)';
  const avCol = t.working ? 'var(--ink)' : 'var(--text-2)';
  const stCls = t.working ? 'on' : 'off';
  const stLbl = t.working ? 'En service' : 'En repos';
  a.innerHTML =
    '<div class="team-av-wrap"><div class="team-av" style="background:' + avBg + ';color:' + avCol + '">' + initials + '</div>' +
    '<div class="team-av-status ' + stCls + '"></div></div>' +
    '<div class="team-info"><div class="team-name">' + t.name + '</div><div class="team-role">' + t.role + '</div></div>' +
    '<span class="team-status ' + (t.working ? 'working' : 'off') + '">' + stLbl + '</span>';
  return a;
}

/* ═══════════════════════════════════════════════════════════════
   WIDGET_CATALOG — cœur (Phase 1/2) + compagnon issus des
   pages-outils (Phase 5). size: S|M|L|XL, category: core|companion.
═══════════════════════════════════════════════════════════════ */
window.WIDGET_CATALOG = {

  'metric-0': { id: 'metric-0', title: 'Métrique principale', size: 'S', category: 'core', source: 'demo',
    keywords: ['ca', "chiffre d'affaires", 'revenu', 'argent gagné', 'encaissé', 'combien j\'ai gagné'],
    defaultVisible: true, defaultOrder: 0,
    render(ctx, el) { const m = ctx.demo.metrics[0]; if (m) el.appendChild(buildMetricCardEl(m, ctx.secteur, 0)); } },
  'metric-1': { id: 'metric-1', title: 'Métrique activité', size: 'S', category: 'core', source: 'demo',
    keywords: ['interventions', 'activité', 'volume'],
    defaultVisible: true, defaultOrder: 1,
    render(ctx, el) { const m = ctx.demo.metrics[1]; if (m) el.appendChild(buildMetricCardEl(m, ctx.secteur, 1)); } },
  'metric-2': { id: 'metric-2', title: 'Métrique clients', size: 'S', category: 'core', source: 'demo',
    keywords: ['clients', 'clientèle'],
    defaultVisible: true, defaultOrder: 2,
    render(ctx, el) { const m = ctx.demo.metrics[2]; if (m) el.appendChild(buildMetricCardEl(m, ctx.secteur, 2)); } },
  'metric-3': { id: 'metric-3', title: 'Métrique devis', size: 'S', category: 'core', source: 'demo',
    keywords: ['devis en attente', 'devis'],
    defaultVisible: true, defaultOrder: 3,
    render(ctx, el) { const m = ctx.demo.metrics[3]; if (m) el.appendChild(buildMetricCardEl(m, ctx.secteur, 3)); } },

  'bento-chart': { id: 'bento-chart', title: 'Cockpit financier', size: 'L', category: 'core', source: 'demo',
    keywords: ['cockpit financier', 'graphique', 'courbe', "évolution ca", 'chiffre d\'affaires'],
    defaultVisible: true, defaultOrder: 4,
    render(ctx, el) {
      const goal = ctx.demo.goal;
      const cur = goal ? goal.current : 0;
      if (cur <= 0 || typeof d3 === 'undefined') {
        el.innerHTML = '<div class="bc-pad">' + buildBentoChartHTML(goal, ctx.sym) + '</div>';
        return;
      }
      const tgt = goal.target || 0;
      const pct = tgt > 0 ? Math.round((cur / tgt) * 100) : null;
      const deltaLabel = pct !== null ? (pct >= 100 ? '✓ Objectif atteint' : pct + " % de l'objectif") : '+12% vs mois précédent';
      const totalFmt = cur >= 1000 ? (cur / 1000).toFixed(1).replace('.', ',') + ' k' : cur.toString();
      el.innerHTML = '<div class="bc-pad">' +
        '<div class="bc-hdr">' +
        '<div><div class="bc-amount">' + totalFmt + '<span class="bc-u">' + ctx.sym + '</span></div>' +
        '<div class="bc-delta-row"><span class="bc-delta up">↑ ' + deltaLabel + '</span></div></div>' +
        '<span style="font-size:.73rem;color:var(--text-2);">Ce mois · ' + new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) + '</span>' +
        '</div><div class="bc-d3-wrap"></div></div>';
      renderFinanceChartD3(el.querySelector('.bc-d3-wrap'), buildFinanceSeries(ctx.secteur, cur), ctx.sym);
    } },
  'bento-actions': { id: 'bento-actions', title: 'Actions flash', size: 'L', category: 'core', source: 'static',
    keywords: ['actions flash', 'raccourcis', 'programmer intervention', 'envoyer lien paiement'],
    defaultVisible: true, defaultOrder: 5,
    render(ctx, el) {
      el.innerHTML = '<div class="bento-flash" style="padding:14px;">' +
        '<a href="planning.html" class="flash-btn"><div class="flash-ico"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#00C896" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="14" height="14" rx="2"/><path d="M3 8h14M8 4V2M12 4V2"/></svg></div><div><span class="flash-txt">Programmer une intervention</span><span class="flash-sub">Créer et assigner en 3 clics</span></div></a>' +
        '<button class="flash-btn" onclick="copyLink(this)"><div class="flash-ico"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#00C896" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M9 3h8v8"/></svg></div><div><span class="flash-txt">Envoyer un lien de paiement</span><span class="flash-sub">Copier votre lien portail client</span></div></button>' +
        '<a href="devis-nouveau.html" class="flash-btn"><div class="flash-ico"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#00C896" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/><path d="M8 8h4M8 12h2"/></svg></div><div><span class="flash-txt">Créer un devis</span><span class="flash-sub">Devis signable en 2 minutes</span></div></a></div>';
    } },

  'timeline': { id: 'timeline', title: "Journée d'aujourd'hui", size: 'L', category: 'core', source: 'demo',
    keywords: ['planning', "aujourd'hui", 'journée', 'agenda du jour'],
    defaultVisible: true, defaultOrder: 6, link: { href: 'planning.html', label: 'Voir le planning →' },
    render(ctx, el) { el.innerHTML = buildTimelineHTML(ctx.demo.timeline); } },

  'activity': { id: 'activity', title: 'Activité récente', size: 'L', category: 'core', source: 'demo',
    keywords: ['activité récente', 'historique', 'derniers événements'],
    defaultVisible: true, defaultOrder: 7, link: { href: 'historique.html', label: 'Tout voir →' },
    render(ctx, el) { el.innerHTML = buildActivityHTML(ctx.demo.activity); } },

  'recos': { id: 'recos', title: 'Recommandations Seba', size: 'L', category: 'core', source: 'demo',
    keywords: ['recommandations', 'conseils', 'suggestions', 'alertes'],
    defaultVisible: true, defaultOrder: 8,
    render(ctx, el) { el.innerHTML = evaluateRules(ctx).map(buildRecoItemHTML).join(''); } },

  'quick-actions': { id: 'quick-actions', title: 'Actions rapides', size: 'M', category: 'core', source: 'static',
    keywords: ['actions rapides', 'créer', 'ajouter'],
    defaultVisible: true, defaultOrder: 9,
    render(ctx, el) {
      el.innerHTML = '<div class="qa-grid">' +
        '<a href="clients.html" class="qa-btn">+ Client</a><a href="devis-nouveau.html" class="qa-btn">+ Devis</a>' +
        '<a href="planning.html" class="qa-btn">+ Intervention</a><a href="factures.html" class="qa-btn">+ Facture</a></div>';
    } },

  'goal': { id: 'goal', title: 'Objectif du mois', size: 'M', category: 'core', source: 'demo',
    keywords: ['objectif', 'objectif du mois', 'progression'],
    defaultVisible: true, defaultOrder: 10, link: { href: 'factures.html', label: 'Factures →' },
    render(ctx, el) {
      const g = ctx.demo.goal;
      const pct = g.target > 0 ? Math.min(100, Math.round(g.current / g.target * 100)) : 0;
      const remaining = g.target - g.current;
      const sub = g.target > 0 ? (pct >= 100 ? 'Objectif atteint ce mois !' : fmtNum(remaining, g.unit) + " restants pour atteindre l'objectif") : 'Configurez votre objectif mensuel dans les réglages.';
      el.innerHTML = '<div class="goal-block">' +
        '<div class="goal-head"><span class="goal-current">' + (g.current > 0 ? fmtNum(g.current, g.unit) : '—') + '</span>' +
        '<span class="goal-target-txt">' + (g.target > 0 ? '/ ' + fmtNum(g.target, g.unit) + ' objectif' : 'Définir un objectif') + '</span></div>' +
        '<div class="goal-bar-track"><div class="goal-bar-fill" style="width:0"></div></div>' +
        '<div class="goal-sub">' + sub + '</div></div>';
      setTimeout(() => { const bar = el.querySelector('.goal-bar-fill'); if (bar) bar.style.width = pct + '%'; }, 400);
    } },

  'workspace': { id: 'workspace', title: 'Votre espace', size: 'L', category: 'core', source: 'demo',
    keywords: ['espace', 'mon entreprise', 'profil'],
    defaultVisible: true, defaultOrder: 11, link: { href: 'reglages.html', label: 'Réglages →' },
    render(ctx, el) {
      const sc = ctx.services.length;
      el.innerHTML =
        '<div class="ws-row"><span class="ws-label">Secteur</span><span class="ws-val">' + ctx.sectorLabel + '</span></div>' +
        '<a href="reglages.html" class="ws-row"><span class="ws-label">Services actifs</span><span class="ws-val link">' + sc + ' service' + (sc !== 1 ? 's' : '') + ' →</span></a>' +
        '<div class="ws-row"><span class="ws-label">Portail</span><span class="ws-val" style="color:#16A34A">Actif</span></div>' +
        '<div class="ws-row"><span class="ws-label">Pays / Devise</span><span class="ws-val">' + (ctx.biz.pays || '—') + ' · ' + ctx.sym + '</span></div>';
    } },

  'portal': { id: 'portal', title: 'Portail client', size: 'L', category: 'core', source: 'demo',
    keywords: ['portail client', 'lien client', 'partager'],
    defaultVisible: true, defaultOrder: 12,
    render(ctx, el) {
      const publicName = ctx.biz.publicName || ctx.nom;
      const portalUrl = 'seba.app/p/' + ctx.slug;
      const portalCode = 'SEBA-' + ctx.slug.substring(0, 4).toUpperCase();
      el.innerHTML = '<div class="portal-block">' +
        '<div class="portal-name">' + publicName + '</div>' +
        '<div class="portal-url-txt" id="portal-url">' + portalUrl + '</div>' +
        '<div class="portal-code-row"><span class="portal-code-lbl">Code d\'accès</span><span class="code-chip">' + portalCode + '</span></div>' +
        '<div class="portal-actions">' +
        '<button class="portal-btn" id="copy-btn" onclick="copyLink(this)"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M3 11H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1"/></svg>Copier le lien</button>' +
        '<a href="client.html" class="portal-btn primary" target="_blank">Voir l\'aperçu</a></div></div>';
    } },

  'team': { id: 'team', title: "Équipe aujourd'hui", size: 'L', category: 'core', source: 'demo',
    keywords: ['équipe', 'collaborateurs', 'employés', 'qui travaille'],
    defaultVisible: true, defaultOrder: 13, link: { href: 'equipe.html', label: 'Voir tout →' },
    render(ctx, el) {
      const real = buildRealTeamStatus(ctx.rhEmployees, ctx.rhPointages);
      const list = real.length ? real : ctx.demo.team;
      if (!list.length) { el.innerHTML = '<div class="tl-empty">Aucun employé. <a href="equipe.html" style="color:var(--emerald)">Ajouter →</a></div>'; return; }
      el.innerHTML = '';
      list.forEach(t => el.appendChild(buildTeamItemEl(t, ctx.couleur)));
    } },

  /* ── Compagnon — issus des pages-outils déjà construites (Phase 5) ── */
  'lot-impayes': { id: 'lot-impayes', title: 'Factures en retard', size: 'M', category: 'companion', source: 'lot:contentieux',
    keywords: ['factures en retard', 'impayés', 'relances', 'créances', 'factures impayées'],
    defaultVisible: false, defaultOrder: 20, link: { href: 'contentieux-recouvrement.html', label: 'Recouvrement →' },
    render(ctx, el) {
      const RELANCE_LABELS = ['Amiable J+8', 'Relance 1 J+30', 'Relance 2 J+60', 'Mise en demeure J+90', 'Huissier / LRE'];
      const list = (ctx.creances || []).slice().sort((a, b) => b.relanceStep - a.relanceStep);
      if (!list.length) { el.innerHTML = '<div class="tl-empty">✓ Aucune facture en retard.</div>'; return; }
      const total = list.reduce((s, c) => s + c.montant, 0);
      el.innerHTML = '<div class="ws-row"><span class="ws-label">' + list.length + ' facture(s) en retard</span><span class="ws-val">' + total.toLocaleString('fr-FR') + ' €</span></div>' +
        list.slice(0, 3).map(c =>
          '<div class="ws-row"><span class="ws-label">' + c.client + '</span><span class="ws-val" style="color:' + (c.relanceStep >= 2 ? '#DC2626' : '#F59E0B') + '">' + (c.montant).toLocaleString('fr-FR') + ' € · ' + (RELANCE_LABELS[c.relanceStep] || '') + '</span></div>'
        ).join('');
    } },

  'lot-pipeline': { id: 'lot-pipeline', title: 'Pipeline devis → facture → encaissé', size: 'XL', category: 'companion', source: 'lot:mutation',
    keywords: ['pipeline', 'devis facture encaissé', 'kanban commercial', 'suivi commercial'],
    defaultVisible: false, defaultOrder: 21, link: { href: 'mutation-contextuelle.html', label: 'Pipeline complet →' },
    render(ctx, el) {
      const docs = ctx.mutationDocs || [];
      if (!docs.length) { el.innerHTML = '<div class="tl-empty">Aucun dossier dans le pipeline. <a href="mutation-contextuelle.html" style="color:var(--emerald)">Créer un RDV →</a></div>'; return; }
      const STAGES = [['rdv', 'RDV'], ['devis', 'Devis'], ['facture', 'Facture'], ['encaisse', 'Encaissé']];
      el.innerHTML = '<div class="qa-grid" style="grid-template-columns:repeat(4,1fr);">' +
        STAGES.map(([key, label]) => {
          const n = docs.filter(d => d.stage === key).length;
          return '<div class="ws-row" style="flex-direction:column;align-items:flex-start;gap:2px;"><span class="ws-label">' + label + '</span><span class="ws-val" style="font-size:1.1rem;font-weight:700;">' + n + '</span></div>';
        }).join('') + '</div>';
    } },

  'lot-tournee': { id: 'lot-tournee', title: 'Tournée du jour', size: 'L', category: 'companion', source: 'lot:haversine',
    keywords: ['tournée', 'tournée du jour', 'itinéraire', 'déplacements', 'route', 'optimiser tournée'],
    defaultVisible: false, defaultOrder: 22, link: { href: 'haversine-engine.html', label: 'Optimiser →' },
    render(ctx, el) {
      const pts = ctx.haversinePts || [];
      if (!pts.length) { el.innerHTML = '<div class="tl-empty">Aucun point de tournée. <a href="haversine-engine.html" style="color:var(--emerald)">Ajouter des points →</a></div>'; return; }
      el.innerHTML = '<div class="ws-row"><span class="ws-label">' + pts.length + ' arrêt(s) programmé(s)</span></div>' +
        pts.slice(0, 5).map(p => '<div class="ws-row"><span class="ws-label">' + p.nom + '</span></div>').join('');
    } },

  'lot-treso': { id: 'lot-treso', title: 'Position de trésorerie', size: 'M', category: 'companion', source: 'lot:treso',
    keywords: ['trésorerie', 'cash', 'position de trésorerie', 'runway'],
    defaultVisible: false, defaultOrder: 23, link: { href: 'cockpit-treso.html', label: 'Simulateur complet →' },
    render(ctx, el) {
      const g = ctx.demo.goal;
      if (!g || g.current <= 0) { el.innerHTML = '<div class="tl-empty">Pas encore de données de trésorerie.</div>'; return; }
      const pct = g.target > 0 ? Math.round(g.current / g.target * 100) : 0;
      el.innerHTML = '<div class="ws-row"><span class="ws-label">Estimation simplifiée (CA du mois)</span><span class="ws-val">' + fmtNum(g.current, g.unit) + '</span></div>' +
        '<div class="ws-row"><span class="ws-label">% de l\'objectif mensuel</span><span class="ws-val">' + pct + '%</span></div>' +
        '<div class="ws-row"><span class="ws-label">Estimation précise</span><span class="ws-val link">Ouvrir le simulateur →</span></div>';
    } },
};

function fmtNum(n, unit) {
  if (n === 0) return unit === '€' ? '0 €' : '0';
  return n.toLocaleString('fr-FR') + (unit ? ' ' + unit : '');
}

/* ── Équipe réelle à partir des pointages (Phase 5.2) ── */
function buildRealTeamStatus(employees, pointages) {
  if (!employees || !employees.length) return [];
  const todayStr = new Date().toDateString();
  return employees.map(e => {
    const todays = (pointages || []).filter(p => p.empId === e.id && new Date(p.ts).toDateString() === todayStr);
    const last = todays[todays.length - 1];
    return { name: e.nom, role: e.poste || e.contrat || 'Collaborateur', working: !!last && last.type === 'IN', href: 'equipe.html' };
  });
}

/* ═══════════════════════════════════════════════════════════════
   MOTEUR DE RÈGLES "COMPAGNON" (Phase 6) — recommandations
   proactives triées par priorité, avec repli sur DEMO[secteur].recos
═══════════════════════════════════════════════════════════════ */
const RULES = [
  { id: 'late-invoices', priority: 90,
    when: ctx => (ctx.creances || []).some(c => c.relanceStep >= 2),
    build: ctx => {
      const late = ctx.creances.filter(c => c.relanceStep >= 2);
      const n = late.length;
      const total = late.reduce((s, c) => s + c.montant, 0);
      return { cls: 'am', title: n + ' facture(s) en retard sérieux', desc: total.toLocaleString('fr-FR') + ' € en attente depuis plus de 60 jours. Relancez maintenant.', cta: 'Relancer', href: 'contentieux-recouvrement.html' };
    } },
  { id: 'devis-stuck', priority: 60,
    when: ctx => (ctx.mutationDocs || []).some(d => d.stage === 'devis' && daysSince(parseFrDate(d.date)) > 7),
    build: ctx => {
      const stuck = ctx.mutationDocs.filter(d => d.stage === 'devis' && daysSince(parseFrDate(d.date)) > 7);
      return { cls: 'em', title: stuck.length + ' devis en attente depuis +7 jours', desc: 'Un dossier oublié dans le pipeline coûte cher — relancez le client.', cta: 'Voir le pipeline', href: 'mutation-contextuelle.html' };
    } },
  { id: 'sector-seed', priority: 10,
    when: () => true,
    build: ctx => ctx.demo.recos },
];

function evaluateRules(ctx) {
  return RULES.filter(r => r.when(ctx)).sort((a, b) => b.priority - a.priority)
    .flatMap(r => { const v = r.build(ctx); return Array.isArray(v) ? v : [v]; });
}

/* ═══════════════════════════════════════════════════════════════
   LAYOUT — visibilité, ordre, taille (Phase 3), persistance
   localStorage['seba_dashboard_layout']
═══════════════════════════════════════════════════════════════ */
function getEffectiveLayout() {
  const stored = SebaLayoutStore.read();
  const storedById = {};
  if (stored && Array.isArray(stored.widgets)) stored.widgets.forEach(w => { storedById[w.id] = w; });
  return Object.values(window.WIDGET_CATALOG).map(w => {
    const o = storedById[w.id];
    return { id: w.id, visible: o ? o.visible : w.defaultVisible, order: o && typeof o.order === 'number' ? o.order : w.defaultOrder, size: (o && o.size) || w.size };
  }).sort((a, b) => a.order - b.order);
}

function saveLayout(layout) { SebaLayoutStore.write({ v: 1, widgets: layout }); }

function addWidgetToLayout(id) {
  const layout = getEffectiveLayout();
  const entry = layout.find(w => w.id === id);
  if (entry) entry.visible = true;
  saveLayout(layout);
  return entry;
}
function removeWidgetFromLayout(id) {
  const layout = getEffectiveLayout();
  const entry = layout.find(w => w.id === id);
  if (entry) entry.visible = false;
  saveLayout(layout);
}
function persistOrder(orderedIds) {
  const layout = getEffectiveLayout();
  const byId = {}; layout.forEach(w => byId[w.id] = w);
  orderedIds.forEach((id, i) => { if (byId[id]) byId[id].order = i; });
  saveLayout(Object.values(byId));
}

/* ═══════════════════════════════════════════════════════════════
   GRILLE UNIFIÉE (Phase 2/3) — construit .widget-shell par widget
   visible, dans l'ordre du layout, taille S/M/L/XL
═══════════════════════════════════════════════════════════════ */
function renderGrid(gridEl, ctx, customizeMode) {
  const layout = getEffectiveLayout();
  gridEl.innerHTML = '';
  const visible = layout.filter(w => w.visible);
  if (!visible.length) {
    gridEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:48px 24px;"><p>Tout est masqué. Ouvrez <strong>Personnaliser</strong> pour ajouter des widgets.</p></div>';
    return;
  }
  visible.forEach(w => {
    const def = window.WIDGET_CATALOG[w.id];
    if (!def) return;
    const shell = document.createElement('div');
    shell.className = 'widget-shell';
    shell.dataset.size = w.size;
    shell.dataset.widgetId = w.id;
    shell.innerHTML =
      '<div class="module-head">' +
      (customizeMode ? '<span class="widget-drag-handle" title="Déplacer">⠿</span>' : '') +
      '<span class="module-title">' + def.title + '</span>' +
      (def.link ? '<a href="' + def.link.href + '" class="module-link">' + def.link.label + '</a>' : '') +
      (customizeMode ? '<button class="widget-remove-btn" title="Retirer" onclick="onWidgetRemove(\'' + w.id + '\')">✕</button>' : '') +
      '</div><div class="widget-body"></div>';
    gridEl.appendChild(shell);
    def.render(ctx, shell.querySelector('.widget-body'));
  });
}

/* ═══════════════════════════════════════════════════════════════
   DRAG-AND-DROP (Phase 4) — SortableJS, actif uniquement en
   mode personnalisation. Boutons clavier monter/descendre en repli.
═══════════════════════════════════════════════════════════════ */
let _sortableInstance = null;
function initSortable(gridEl) {
  if (typeof Sortable === 'undefined') return;
  if (_sortableInstance) { _sortableInstance.destroy(); _sortableInstance = null; }
  _sortableInstance = Sortable.create(gridEl, {
    handle: '.widget-drag-handle',
    animation: 150,
    onEnd() {
      const ids = Array.from(gridEl.children).map(el => el.dataset.widgetId);
      persistOrder(ids);
    },
  });
}
function moveWidget(id, dir) {
  const layout = getEffectiveLayout().filter(w => w.visible);
  const idx = layout.findIndex(w => w.id === id);
  const swapIdx = idx + dir;
  if (idx < 0 || swapIdx < 0 || swapIdx >= layout.length) return;
  const ids = layout.map(w => w.id);
  [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
  persistOrder(ids);
}

/* ═══════════════════════════════════════════════════════════════
   BIBLIOTHÈQUE DE WIDGETS (Phase 3) — panneau "Personnaliser"
═══════════════════════════════════════════════════════════════ */
const CATEGORY_LABEL = { core: 'Cœur', companion: 'Compagnon' };
function buildLibraryPanelHTML() {
  const layout = getEffectiveLayout();
  const byId = {}; layout.forEach(w => byId[w.id] = w);
  const groups = { core: [], companion: [] };
  Object.values(window.WIDGET_CATALOG).forEach(w => groups[w.category].push(w));
  return Object.keys(groups).map(cat => {
    if (!groups[cat].length) return '';
    return '<div class="pal-section"><div class="pal-section-lbl">' + CATEGORY_LABEL[cat] + '</div>' +
      groups[cat].map(w => {
        const visible = byId[w.id] ? byId[w.id].visible : w.defaultVisible;
        return '<label class="widget-lib-row"><span>' + w.title + '</span>' +
          '<input type="checkbox" ' + (visible ? 'checked' : '') + ' onchange="onWidgetToggle(\'' + w.id + '\', this.checked)"></label>';
      }).join('') + '</div>';
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════
   BARRE DE COMMANDE IA SIMULÉE (Phase 7) — matching mots-clés
   100% client, zéro réseau. Gère les requêtes composées ("X et Y").
═══════════════════════════════════════════════════════════════ */
function normalizeText(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function scoreWidget(widgetKeywords, normQuery) {
  let score = 0;
  widgetKeywords.forEach(kw => {
    const nk = normalizeText(kw);
    if (!nk) return;
    if (normQuery.includes(nk)) score += nk.split(' ').length; // matches longer/more specific phrases higher
  });
  return score;
}

function matchIntent(text) {
  const subIntents = text.split(/\s+et\s+|,| \+ /i).map(s => s.trim()).filter(Boolean);
  const results = [];
  subIntents.forEach(sub => {
    const normQuery = normalizeText(sub);
    let best = null, bestScore = 0;
    Object.values(window.WIDGET_CATALOG).forEach(w => {
      const s = scoreWidget(w.keywords || [], normQuery);
      if (s > bestScore) { bestScore = s; best = w; }
    });
    results.push({ query: sub, widget: bestScore > 0 ? best : null, suggestions: bestScore === 0 ? suggestClosest(normQuery) : [] });
  });
  return results;
}

function suggestClosest(normQuery) {
  const scored = Object.values(window.WIDGET_CATALOG).map(w => {
    let s = 0;
    (w.keywords || []).forEach(kw => {
      const nk = normalizeText(kw);
      nk.split(' ').forEach(tok => { if (tok.length > 2 && normQuery.includes(tok)) s++; });
    });
    return { w, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.slice(0, 2).map(x => x.w);
}
