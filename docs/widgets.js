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
      '<div class="bc-empty-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00FF9D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/></svg></div>' +
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
    '<stop offset="0%" stop-color="#00FF9D" stop-opacity="0.18"/><stop offset="100%" stop-color="#00FF9D" stop-opacity="0"/>' +
    '</linearGradient></defs>' +
    '<polygon points="' + fillPoints + '" fill="url(#chart-fill)"/>' +
    '<polyline class="chart-line-anim" points="' + linePoints + '" fill="none" stroke="#00FF9D" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="4" fill="#00FF9D" class="bc-dot"><title>' + totalFmt + ' ' + sym + '</title></circle>' +
    '</svg>' +
    '<div class="bc-months">' + months.map(m => '<span>' + m + '</span>').join('') + '</div>' +
    '</div>';
}

/* Benchmark Airbnb §5.1 : les widgets "Compagnon" (pipeline, tournée, impayés)
   sont defaultVisible:false — donc ajoutés volontairement — souvent le premier
   contact d'un artisan avec ces fonctionnalités avancées. Ils avaient pourtant
   l'état vide le plus pauvre du dashboard (une ligne .tl-empty), alors que
   bento-chart soigne le sien (icône + titre + sous-titre + CTA). Helper unique,
   réutilise .bc-empty-* (déjà générique, pas lié à bento-chart). */
function buildRichEmptyHTML(icon, title, sub, ctaLabel, ctaHref) {
  return '<div class="bc-empty-body">' +
    '<div class="bc-empty-ico">' + icon + '</div>' +
    '<div class="bc-empty-title">' + title + '</div>' +
    '<div class="bc-empty-sub">' + sub + '</div>' +
    (ctaHref ? '<button class="bc-empty-btn" onclick="window.location.href=\'' + ctaHref + '\'">' + ctaLabel + '</button>' : '') +
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
   SVG inline (buildBentoChartHTML) si D3 absent.
   goalTarget (benchmark Stripe §1.1, optionnel) : trace une ligne d'objectif
   en pointillé — la donnée existe déjà (ctx.demo.goal.target, consommée
   par le widget 'goal') mais n'apparaissait jamais sur ce graphique-ci,
   obligeant l'artisan à croiser deux widgets pour voir sa trajectoire. ── */
function renderFinanceChartD3(wrapEl, series, sym, goalTarget) {
  if (typeof d3 === 'undefined' || !wrapEl) return false;
  const W = 400, H = 96, PAD = { top: 8, right: 8, bottom: 4, left: 8 };
  wrapEl.innerHTML = '';
  const svg = d3.select(wrapEl).append('svg')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'none')
    .style('width', '100%').style('display', 'block').style('overflow', 'visible');

  const x = d3.scalePoint().domain(series.map(d => d.month)).range([PAD.left, W - PAD.right]);
  const maxV = Math.max(d3.max(series, d => d.value), goalTarget > 0 ? goalTarget : 0);
  const y = d3.scaleLinear().domain([0, maxV * 1.08]).range([H - PAD.bottom, PAD.top]);

  const defs = svg.append('defs');
  const grad = defs.append('linearGradient').attr('id', 'd3-fin-fill').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#00FF9D').attr('stop-opacity', 0.22);
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#00FF9D').attr('stop-opacity', 0);

  const area = d3.area().x(d => x(d.month)).y0(H - PAD.bottom).y1(d => y(d.value)).curve(d3.curveCatmullRom.alpha(0.6));
  const line = d3.line().x(d => x(d.month)).y(d => y(d.value)).curve(d3.curveCatmullRom.alpha(0.6));

  svg.append('path').datum(series).attr('d', area).attr('fill', 'url(#d3-fin-fill)').attr('opacity', 0)
    .transition().duration(900).delay(350).attr('opacity', 1);

  if (goalTarget > 0) {
    svg.append('line')
      .attr('x1', PAD.left).attr('x2', W - PAD.right)
      .attr('y1', y(goalTarget)).attr('y2', y(goalTarget))
      .attr('stroke', 'rgba(255,255,255,.28)').attr('stroke-width', 1.2).attr('stroke-dasharray', '3 3')
      .attr('opacity', 0).transition().duration(600).delay(250).attr('opacity', 1);
  }

  const path = svg.append('path').datum(series).attr('d', line)
    .attr('fill', 'none').attr('stroke', '#00FF9D').attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
  const len = path.node().getTotalLength();
  path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
    .transition().duration(1200).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);

  const last = series[series.length - 1];
  svg.append('circle').attr('cx', x(last.month)).attr('cy', y(last.value)).attr('r', 4)
    .attr('fill', '#00FF9D').attr('opacity', 0)
    .transition().delay(1100).duration(300).attr('opacity', 1);

  /* Tooltip + crosshair interactifs */
  const focusDot = svg.append('circle').attr('r', 4.5).attr('fill', '#fff')
    .attr('stroke', '#00FF9D').attr('stroke-width', 2.5).style('display', 'none');
  const focusLine = svg.append('line').attr('stroke', 'rgba(0,255,157,.35)')
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

/* Benchmark Shopify §7.1 : sélecteur de période sur le Cockpit financier.
   Ce n'est pas un vrai changement de vue, juste un zoom temporel — et plutôt
   que d'inventer une 3e source de données, on réutilise buildHorizonSeries
   (déjà calculée pour les Lignes d'Horizon : 12 derniers jours, réels via
   SebaDB ou simulés) pour "7 jours", et buildFinanceSeries (existant) pour
   "6 mois". window._ctx est exposé par renderDashboard() (dashboard.html). */
function switchChartPeriod(period) {
  const shell = document.querySelector('[data-widget-id="bento-chart"]');
  const wrap = shell && shell.querySelector('.bc-d3-wrap');
  if (!wrap || !window._ctx) return;
  shell.querySelectorAll('.bc-period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === period));
  const ctx = window._ctx;
  const goal = ctx.demo.goal;
  if (period === 'jour') {
    const daily = buildHorizonSeries(ctx).gains.slice(-7).map(p => ({
      month: new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
      value: p.amount,
    }));
    renderFinanceChartD3(wrap, daily, ctx.sym, 0); // pas de ligne d'objectif sur une granularité journalière
  } else {
    renderFinanceChartD3(wrap, buildFinanceSeries(ctx.secteur, goal ? goal.current : 0), ctx.sym, goal ? goal.target : 0);
  }
}
window.switchChartPeriod = switchChartPeriod;

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
    .attr('stroke', 'rgba(0,255,157,.55)').attr('stroke-width', 1.6).attr('stroke-linecap', 'round');
}

/* ── Chargement paresseux de Leaflet (uniquement si le widget carte est affiché) ── */
let _leafletPromise = null;
/* Instance vivante du widget 'lot-carte' — cf. audit 2.2 (fuite mémoire). */
let _lotCarteMapInstance = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = resolve;
    js.onerror = reject;
    document.head.appendChild(js);
  });
  return _leafletPromise;
}

const TYPE_PILL_LABEL = { intervention: 'Intervention', devis: 'Devis', client: 'Client', paiement: 'Paiement' };

// Echappe le texte libre (noms clients/employes, notes, reponses IA) avant
// injection dans innerHTML — sans ca, un nom de client ou une note contenant
// du HTML s'execute dans le navigateur du patron qui consulte son dashboard.
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function buildTimelineHTML(timeline) {
  if (!timeline.length) return '<div class="tl-empty">Aucune tâche planifiée. <a href="planning.html" style="color:var(--emerald)">Planifier →</a></div>';
  return timeline.map(t =>
    '<a href="' + t.href + '" class="tl-item' + (t.done ? ' done' : '') + '">' +
    '<div class="tl-time-col"><span class="tl-time">' + t.time + '</span><div class="tl-dot' + (t.done ? ' done' : '') + '"></div></div>' +
    '<div><div class="tl-type-pill ' + t.type + '">' + (TYPE_PILL_LABEL[t.type] || t.type) + '</div>' +
    '<div class="tl-label">' + esc(t.label) + '</div>' +
    '<div class="tl-sub">' + esc(t.sub) + '</div></div></a>'
  ).join('');
}

function buildActivityHTML(activity) {
  return activity.map(item =>
    '<a href="' + item.href + '" class="activity-item">' +
    '<div class="act-dot ' + item.type + '"></div>' +
    '<div class="act-body"><div class="act-label">' + esc(item.label) + '</div>' +
    '<div class="act-time">' + esc(item.time) + '</div></div></a>'
  ).join('');
}

function buildRecoItemHTML(r) {
  return '<a href="' + r.href + '" class="reco-item">' +
    '<div class="reco-bar ' + r.cls + '"></div>' +
    '<div class="reco-content"><div class="reco-title">' + esc(r.title) + '</div>' +
    '<div class="reco-desc">' + esc(r.desc) + '</div>' +
    '<div class="reco-cta">' + esc(r.cta) + ' →</div></div></a>';
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
    '<div class="team-info"><div class="team-name">' + esc(t.name) + '</div><div class="team-role">' + esc(t.role) + '</div></div>' +
    '<span class="team-status ' + (t.working ? 'working' : 'off') + '">' + stLbl + '</span>';
  return a;
}

/* ═══════════════════════════════════════════════════════════════
   SERENITY SCORE (Bible I.1) — sphère-nébuleuse à particules,
   cœur réacteur du dashboard. Canvas 2D + requestAnimationFrame.
   Couleur et vitesse de pulsation pilotées par l'état de santé
   (sain/attention/alerte), lu depuis pro-global.css → s'adapte
   automatiquement au thème Dark/Light sans code supplémentaire.
═══════════════════════════════════════════════════════════════ */

/* Score composite 0-100 : objectif du mois (poids fort), factures
   en retard sérieux (poids fort), devis qui traînent (poids léger).
   Pondérations choisies pour qu'un seul red flag grave (facture en
   contentieux, CA très en retard) fasse déjà basculer en "attention". */
function computeSerenityScore(wctx) {
  let score = 100;
  const goal = wctx.demo && wctx.demo.goal;
  if (goal && goal.target > 0) {
    const pct = goal.current / goal.target;
    if (pct < 0.4) score -= 30;
    else if (pct < 0.7) score -= 15;
    else if (pct < 0.9) score -= 5;
  }
  const lateInvoices = (wctx.creances || []).filter(c => c.relanceStep >= 2).length;
  score -= Math.min(30, lateInvoices * 10);
  const devisMetric = wctx.demo && wctx.demo.metrics && wctx.demo.metrics[3];
  if (devisMetric && devisMetric.up === false) {
    const n = parseInt(devisMetric.delta, 10);
    if (!isNaN(n)) score -= Math.min(20, n * 5);
  }
  return Math.max(5, Math.min(100, Math.round(score)));
}

function readThemeVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function serenityStateFor(score) {
  if (score >= 70) return { key: 'sain', label: 'Stable', varName: '--emerald', fallback: '#00FF9D', speed: 0.010, jitter: 0.15 };
  if (score >= 40) return { key: 'attention', label: 'Vigilance', varName: '--amber', fallback: '#FFB800', speed: 0.020, jitter: 0.35 };
  return { key: 'alerte', label: 'Alerte', varName: '--critical', fallback: '#8B1E1E', speed: 0.032, jitter: 0.6 };
}

function renderSerenityScore(wctx, el) {
  const score = computeSerenityScore(wctx);
  const state = serenityStateFor(score);
  maybeTriggerAIOnSerenity(state, wctx); // Bible V.1 — entrée en alerte seulement
  const goal = wctx.demo.goal;
  /* Trésorerie = estimation simplifiée (CA du mois moins les factures en retard
     encore non encaissées) — même logique que le companion "Position de
     trésorerie", pas un vrai calcul de cash-flow. */
  const lateTotal = (wctx.creances || []).reduce((s, c) => s + (c.montant || 0), 0);
  const tresorerie = Math.max(0, goal.current - lateTotal);

  el.innerHTML =
    '<div class="serenity-wrap">' +
      '<canvas class="serenity-canvas"></canvas>' +
      '<div class="serenity-readout">' +
        '<div class="serenity-score-num">' + score + '</div>' +
        '<div class="serenity-score-lbl">' + state.label + '</div>' +
      '</div>' +
      '<div class="serenity-orbit">' +
        '<span class="serenity-orbit-item o10h"><span class="oi-lbl">Trésorerie</span><span class="oi-val">' + fmtNum(tresorerie, wctx.sym) + '</span></span>' +
        '<span class="serenity-orbit-item o2h"><span class="oi-lbl">CA</span><span class="oi-val">' + fmtNum(goal.current, wctx.sym) + '</span></span>' +
      '</div>' +
    '</div>';

  const wrap = el.querySelector('.serenity-wrap');
  const canvas = el.querySelector('.serenity-canvas');
  const shell = el.closest('.widget-shell');
  if (shell) shell.dataset.serenityState = state.key;
  startSerenityAnimation(canvas, wrap, state);
}

function startSerenityAnimation(canvas, wrap, state) {
  state.color = readThemeVar(state.varName, state.fallback);
  const ctx2d = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W, H, cx, cy, R;

  function resize() {
    const rect = wrap.getBoundingClientRect();
    W = canvas.width = Math.max(1, Math.round(rect.width * dpr));
    H = canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    cx = W / 2; cy = H / 2; R = Math.min(W, H) * 0.34;
  }
  resize();
  window.addEventListener('resize', resize);

  const onThemeChange = () => { state.color = readThemeVar(state.varName, state.fallback); };
  document.addEventListener('seba-theme-change', onThemeChange);

  // Densite reduite (etait 90) : le rendu original ("particules dorees" en
  // etat Vigilance) lisait trop "gadget/jeu video" pour un indicateur de
  // sante de compte destine a des patrons de PME non-tech (audit du
  // 2026-07-08). Le mecanisme reste identique, juste plus sobre.
  const N = 36;
  const particles = Array.from({ length: N }, () => ({
    baseAngle: Math.random() * Math.PI * 2,
    baseRadius: Math.sqrt(Math.random()) * R,
    z: Math.random(),
    speed: (Math.random() * 0.4 + 0.6) * (Math.random() < 0.5 ? 1 : -1),
    wobble: Math.random() * Math.PI * 2,
  }));

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = null;
  let t = 0;

  function frame() {
    t += 1;
    ctx2d.clearRect(0, 0, W, H);
    const pulse = 1 + Math.sin(t * state.speed) * 0.06;
    const coreR = R * 0.22 * pulse;

    /* Halo nébuleuse — flou gaussien natif du canvas */
    ctx2d.save();
    ctx2d.filter = 'blur(' + Math.round(14 * dpr) + 'px)';
    ctx2d.globalAlpha = 0.22;
    ctx2d.fillStyle = state.color;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, coreR * 1.6, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.restore();

    /* Champ de particules — densité/luminosité liées à la profondeur simulee (z) */
    particles.forEach((p) => {
      const jitterA = Math.sin(t * 0.01 * p.speed + p.wobble) * state.jitter;
      const ang = p.baseAngle + t * 0.0006 * p.speed + jitterA * 0.15;
      const rad = p.baseRadius * pulse + Math.sin(t * 0.02 + p.wobble) * (4 * dpr) * state.jitter;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad * 0.86;
      const size = (1.2 + p.z * 2.2) * dpr;
      ctx2d.globalAlpha = 0.15 + p.z * 0.4;
      ctx2d.fillStyle = state.color;
      ctx2d.beginPath();
      ctx2d.arc(x, y, size, 0, Math.PI * 2);
      ctx2d.fill();
    });

    /* Noyau brillant */
    const grad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    grad.addColorStop(0, state.color);
    grad.addColorStop(1, 'transparent');
    ctx2d.globalAlpha = 0.9;
    ctx2d.fillStyle = grad;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;

    if (!reduceMotion) raf = requestAnimationFrame(frame);
  }
  frame();

  /* Le widget est reconstruit à chaque rendu de grille (innerHTML) — sans
     ce nettoyage, chaque re-rendu laisserait tourner une boucle rAF fantôme. */
  const observer = new MutationObserver(() => {
    if (!document.body.contains(canvas)) {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('seba-theme-change', onThemeChange);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ═══════════════════════════════════════════════════════════════
   VECTEURS D'ACTION (Bible II.4) — cartes de gain, pas de tâches.
   On n'écrit pas "Relancer facture", on écrit "Récupérer 200 €" :
   la vignette annonce un gain, la validation l'efface fluidement.
═══════════════════════════════════════════════════════════════ */

/* Génère une carte .action-vector dans #action-stream et branche sa
   validation (fade + scale, puis retrait du DOM). Ne fait aucune
   hypothèse sur le contenu : title/amount sont du texte déjà formaté. */
function createActionCard(title, amount) {
  const stream = document.getElementById('action-stream');
  if (!stream) return null;

  const card = document.createElement('div');
  card.className = 'action-vector';
  card.innerHTML =
    '<div>' +
      '<div class="av-title">' + esc(title) + '</div>' +
      '<div class="av-amount">' + esc(amount) + '</div>' +
    '</div>' +
    '<button class="av-validate" type="button">Valider</button>';

  card.querySelector('.av-validate').addEventListener('click', () => {
    card.classList.add('leaving');
    card.addEventListener('transitionend', () => card.remove(), { once: true });
  });

  stream.appendChild(card);
  return card;
}

/* Peuple le flux avec de vrais vecteurs (factures en retard, s'il y en a)
   plutôt que des tâches génériques ; repli sur un exemple si tout est propre. */
function populateActionStream(wctx) {
  const stream = document.getElementById('action-stream');
  if (!stream) return;
  stream.innerHTML = '';
  const late = (wctx.creances || []).slice(0, 3);
  if (late.length) {
    late.forEach(c => createActionCard(
      'Relancer ' + c.client,
      'Récupération immédiate : ' + c.montant.toLocaleString('fr-FR') + ' ' + wctx.sym
    ));
  } else {
    createActionCard('Envoyer un lien de paiement', 'Encaissement possible aujourd\'hui');
  }
}

/* ═══════════════════════════════════════════════════════════════
   LIGNES D'HORIZON (Bible II.5) — courbes de lumière pure (Canvas,
   pas de dépendance D3), sans axes ni cadre. Émeraude = encaissé,
   ambre = en attente/retard (l'app ne modélise pas de vraies
   "dépenses" ; on réutilise donc les factures non payées, cohérent
   avec le sens "ambre = vigilance" déjà établi ailleurs).
═══════════════════════════════════════════════════════════════ */

function buildHorizonSeries(wctx) {
  const DB = window.SebaDB;
  if (DB && DB.hasData()) {
    const factures = DB.list('factures');
    const toPoint = f => ({ date: f.paidAt || f.date, amount: f.amount });
    const gains = factures.filter(f => f.status === 'payee').map(toPoint)
      .filter(p => p.date).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-12);
    const pending = factures.filter(f => f.status !== 'payee').map(toPoint)
      .filter(p => p.date).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-12);
    if (gains.length || pending.length) return { gains, pending };
  }
  /* Démo : pas de vraies transactions datées disponibles — trajectoire
     plausible sur les 12 derniers jours, mise à l'échelle du CA affiché. */
  const today = new Date();
  const base = (wctx.demo.goal && wctx.demo.goal.current) ? wctx.demo.goal.current / 9 : 150;
  const mk = (n, amp, variance) => Array.from({ length: n }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - (n - 1 - i));
    return { date: localHorizonISO(d), amount: Math.max(10, Math.round(amp * variance[i % variance.length])) };
  });
  return {
    gains: mk(12, base, [0.7, 0.9, 1.1, 0.8, 1.3, 1.0, 0.6, 1.2, 0.9, 1.4, 1.0, 1.1]),
    pending: mk(6, base * 0.35, [1, 0.5, 1.2, 0.8, 1, 0.6]),
  };
}

function localHorizonISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* Le canvas #horizon-line est un élément fixe de dashboard.html (pas
   recréé via innerHTML comme les widgets de la grille) : renderDashboard()
   peut être rappelé plusieurs fois (changement de données). Sans ce
   handle, chaque appel empilerait une nouvelle boucle rAF fantôme. */
let _horizonCleanup = null;

function renderHorizonLine(wctx) {
  const canvas = document.getElementById('horizon-line');
  if (!canvas) return;
  if (_horizonCleanup) { _horizonCleanup(); _horizonCleanup = null; }
  const series = buildHorizonSeries(wctx);
  maybeTriggerAIOnHorizon(series, wctx.sym); // Bible V.1 — point majeur, une fois
  _horizonCleanup = startHorizonAnimation(canvas, canvas.parentElement, series, wctx.sym);
}

function startHorizonAnimation(canvas, wrap, series, sym) {
  const ctx2d = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0, gainsPts = [], pendingPts = [];

  function layout(points) {
    if (!points.length) return [];
    const max = Math.max.apply(null, points.map(p => p.amount).concat([1]));
    const padX = W * 0.03, padY = H * 0.24;
    return points.map((p, i) => ({
      date: p.date, amount: p.amount,
      x: padX + (points.length === 1 ? (W - padX * 2) / 2 : (i / (points.length - 1)) * (W - padX * 2)),
      y: H - padY - (p.amount / max) * (H - padY * 2),
    }));
  }

  function resize() {
    const rect = wrap.getBoundingClientRect();
    W = canvas.width = Math.max(1, Math.round(rect.width * dpr));
    H = canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    gainsPts = layout(series.gains);
    pendingPts = layout(series.pending);
  }
  resize();
  window.addEventListener('resize', resize);

  /* Courbe lissée Catmull-Rom → bézier, sans dépendance externe */
  function smoothPath(pts) {
    const path = new Path2D();
    if (!pts.length) return path;
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      path.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
        p2.x, p2.y
      );
    }
    return path;
  }

  function drawGlowLine(color, pts, wobble) {
    if (pts.length < 2) return;
    const wobbled = pts.map(p => ({ x: p.x, y: p.y + wobble }));
    const path = smoothPath(wobbled);
    ctx2d.save();
    ctx2d.filter = 'blur(' + Math.round(3 * dpr) + 'px)';
    ctx2d.strokeStyle = color; ctx2d.lineWidth = 3.5 * dpr; ctx2d.globalAlpha = 0.5;
    ctx2d.stroke(path);
    ctx2d.restore();
    ctx2d.strokeStyle = color; ctx2d.lineWidth = 1.8 * dpr; ctx2d.globalAlpha = 1;
    ctx2d.lineCap = 'round'; ctx2d.lineJoin = 'round';
    ctx2d.stroke(path);
  }

  /* ── Ligne Temporelle : point le plus proche du curseur (X), tous points confondus ── */
  const tip = document.createElement('div');
  tip.className = 'horizon-tip';
  wrap.appendChild(tip);
  let hover = null;

  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * dpr;
    const all = gainsPts.map(p => ({ p, kind: 'gain' })).concat(pendingPts.map(p => ({ p, kind: 'pending' })));
    if (!all.length) { hover = null; tip.classList.remove('visible'); return; }
    let best = all[0], bd = Infinity;
    all.forEach(o => { const d = Math.abs(o.p.x - mx); if (d < bd) { bd = d; best = o; } });
    hover = best;
    const dateLbl = new Date(best.p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    tip.textContent = dateLbl + ' · ' + best.p.amount.toLocaleString('fr-FR') + ' ' + sym;
    tip.style.left = (best.p.x / dpr) + 'px';
    tip.style.top = (best.p.y / dpr) + 'px';
    tip.classList.add('visible');
  }
  function onLeave() { hover = null; tip.classList.remove('visible'); }
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);

  const emerald = () => readThemeVar('--emerald', '#00FF9D');
  const amber = () => readThemeVar('--amber', '#FFB800');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = null, t = 0;

  function frame() {
    t += 1;
    ctx2d.clearRect(0, 0, W, H);
    const wobble = Math.sin(t * 0.018) * (H * 0.012);
    drawGlowLine(emerald(), gainsPts, wobble);
    drawGlowLine(amber(), pendingPts, -wobble);

    if (hover) {
      const c = hover.kind === 'gain' ? emerald() : amber();
      ctx2d.beginPath();
      ctx2d.arc(hover.p.x, hover.p.y, 5 * dpr, 0, Math.PI * 2);
      ctx2d.fillStyle = c;
      ctx2d.shadowColor = c; ctx2d.shadowBlur = 12 * dpr;
      ctx2d.fill();
      ctx2d.shadowBlur = 0;
    }
    if (!reduceMotion) raf = requestAnimationFrame(frame);
  }
  frame();

  return function destroy() {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseleave', onLeave);
    tip.remove();
  };
}

/* ═══════════════════════════════════════════════════════════════
   TIMELINE DE VIE (Bible III.6) — pouls de l'activité. Rail vertical
   fixe (hors grille), un point par événement récent, en flux continu
   (les points dérivent le long de la ligne façon courant, pas figés
   après leur entrée). Chaque point émet une onde de choc périodique
   (taille/luminosité ∝ importance). Au survol, description en fondu.
═══════════════════════════════════════════════════════════════ */

const TL_LIFE_TYPE_LABEL = { client: 'Client', paiement: 'Paiement', devis: 'Devis', intervention: 'Intervention' };

/* Reconstruit une "importance" (0..1) à partir du montant embarqué dans le
   libellé quand il y en a un (ex: "· 160 €"), sinon un poids par défaut
   selon le type d'événement — même hiérarchie que les points de couleur
   déjà utilisés ailleurs (paiement/intervention = émeraude, devis = ambre,
   client = plum). */
function buildTimelinePulses(wctx) {
  const activity = (wctx.demo && wctx.demo.activity) || [];
  const DEFAULT_IMPORTANCE = { paiement: 0.6, devis: 0.5, client: 0.4, intervention: 0.3 };
  return activity.map((a, i) => {
    const m = /([\d\s]+)\s*€/.exec(a.label || '');
    const amount = m ? parseInt(m[1].replace(/\s/g, ''), 10) : null;
    const raw = amount != null ? amount / 500 : (DEFAULT_IMPORTANCE[a.type] || 0.35);
    return {
      id: i, type: a.type, label: a.label, time: a.time, href: a.href,
      importance: Math.max(0.25, Math.min(1, raw)),
    };
  });
}

function timelineColorFor(type) {
  if (type === 'devis') return readThemeVar('--amber', '#FFB800');
  if (type === 'client') return readThemeVar('--plum', '#C9A9DA');
  return readThemeVar('--emerald', '#00FF9D'); // paiement, intervention, défaut
}

let _timelineLifeCleanup = null;
let _timelineLifeMQ = null;
let _timelineLifeMQHandler = null;

/* Audit 3.4 : .timeline-life-rail est caché en CSS sous 1180px, mais la boucle
   rAF tournait quand même en continu sur un canvas réduit à 1×1px (coût minime
   par frame, mais une boucle qui tourne pour rien sur tout appareil mobile).
   On n'anime désormais que si le rail est effectivement visible, et on
   démarre/arrête dynamiquement au franchissement du seuil (redimensionnement,
   rotation d'écran) plutôt que de figer la décision au premier rendu. */
function renderTimelineLife(wctx) {
  const canvas = document.getElementById('timeline-life');
  if (!canvas) return;
  if (_timelineLifeCleanup) { _timelineLifeCleanup(); _timelineLifeCleanup = null; }
  if (_timelineLifeMQ && _timelineLifeMQHandler) {
    if (_timelineLifeMQ.removeEventListener) _timelineLifeMQ.removeEventListener('change', _timelineLifeMQHandler);
    else if (_timelineLifeMQ.removeListener) _timelineLifeMQ.removeListener(_timelineLifeMQHandler);
  }
  const events = buildTimelinePulses(wctx);
  const mq = window.matchMedia('(min-width: 1181px)');
  _timelineLifeMQ = mq;
  function apply(visible) {
    if (_timelineLifeCleanup) { _timelineLifeCleanup(); _timelineLifeCleanup = null; }
    if (visible) _timelineLifeCleanup = startTimelineLifeAnimation(canvas, canvas.parentElement, events);
  }
  apply(mq.matches);
  _timelineLifeMQHandler = (e) => apply(e.matches);
  if (mq.addEventListener) mq.addEventListener('change', _timelineLifeMQHandler);
  else if (mq.addListener) mq.addListener(_timelineLifeMQHandler); // Safari <14
}

function startTimelineLifeAnimation(canvas, wrap, events) {
  const ctx2d = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, cx = 0, loopLen = 0, points = [];

  function layout() {
    const n = events.length;
    loopLen = H + 40 * dpr; // marge de rebouclage, invisible au-dessus/en dessous du rail
    points = events.map((ev, i) => ({
      ev,
      offset: n > 0 ? (i / n) * loopLen : 0,
      phase: (i * 613) % 2600, // décalage du pouls, déterministe mais désynchronisé
    }));
  }

  function resize() {
    const rect = wrap.getBoundingClientRect();
    W = canvas.width = Math.max(1, Math.round(rect.width * dpr));
    H = canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    cx = W / 2;
    layout();
  }
  resize();
  window.addEventListener('resize', resize);

  const SPEED = 12 * dpr; // px/s — vitesse du courant

  /* Position courante d'un point : soit il dérive le long du rail (flux
     continu, du haut vers le bas, rebouclage transparent), soit — sous
     prefers-reduced-motion — il reste à une position fixe et répartie. */
  function currentY(p, elapsedSec) {
    if (reduceMotion) {
      const n = events.length;
      const idx = events.indexOf(p.ev);
      return n <= 1 ? H / 2 : H * 0.08 + (idx / (n - 1)) * H * 0.84;
    }
    return ((p.offset + elapsedSec * SPEED) % loopLen) - 20 * dpr;
  }

  /* Fondu près des bords du rail : les points naissent et s'estompent
     plutôt que d'apparaître/disparaître brutalement au rebouclage. */
  function edgeFade(y) {
    if (y < 0 || y > H) return 0;
    const margin = 26 * dpr;
    return Math.min(1, Math.min(y / margin, (H - y) / margin));
  }

  const tip = document.createElement('div');
  tip.className = 'tl-life-tip';
  wrap.appendChild(tip);
  let hover = null;
  const start = performance.now();

  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    const my = (e.clientY - rect.top) * dpr;
    const elapsedSec = (performance.now() - start) / 1000;
    /* Seuil généreux : les points dérivent en continu, un utilisateur ne peut
       pas viser un pixel précis — on capte le plus proche dans une zone large. */
    let best = null, bestY = 0, bd = 55 * dpr;
    points.forEach(p => {
      const y = currentY(p, elapsedSec);
      const d = Math.abs(y - my);
      if (d < bd) { bd = d; best = p; bestY = y; }
    });
    hover = best;
    if (best) {
      const lbl = (TL_LIFE_TYPE_LABEL[best.ev.type] || '') + ' — ' + best.ev.label + ' · ' + best.ev.time;
      tip.textContent = lbl;
      tip.style.left = (cx / dpr - 14) + 'px';
      tip.style.top = (bestY / dpr) + 'px';
      tip.classList.add('visible');
    } else {
      tip.classList.remove('visible');
    }
  }
  function onLeave() { hover = null; tip.classList.remove('visible'); }
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);

  const PULSE_PERIOD = 2600; // ms, un battement toutes les ~2.6s
  let raf = null;

  function frame() {
    const elapsedMs = performance.now() - start;
    const elapsedSec = elapsedMs / 1000;
    ctx2d.clearRect(0, 0, W, H);

    /* Fil de lumière — le "courant" que traversent les ondes */
    const lineColor = readThemeVar('--border', 'rgba(255,255,255,.1)');
    ctx2d.strokeStyle = lineColor;
    ctx2d.lineWidth = 1.5 * dpr;
    ctx2d.beginPath();
    ctx2d.moveTo(cx, 0);
    ctx2d.lineTo(cx, H);
    ctx2d.stroke();

    points.forEach(p => {
      const y = currentY(p, elapsedSec);
      const alpha = edgeFade(y);
      if (alpha <= 0) return;
      const color = timelineColorFor(p.ev.type);
      const isHover = hover === p;

      /* Onde de choc périodique — taille/opacité ∝ importance */
      if (!reduceMotion) {
        const cyclePos = ((elapsedMs + p.phase) % PULSE_PERIOD) / PULSE_PERIOD;
        const waveR = (3 + p.ev.importance * 18) * cyclePos * dpr;
        const waveA = (1 - cyclePos) * 0.55 * p.ev.importance * alpha;
        ctx2d.beginPath();
        ctx2d.arc(cx, y, waveR, 0, Math.PI * 2);
        ctx2d.strokeStyle = color;
        ctx2d.globalAlpha = waveA;
        ctx2d.lineWidth = 1.6 * dpr;
        ctx2d.stroke();
      }

      /* Point de l'événement, porté par le courant */
      const dotR = (isHover ? 5 : 3 + p.ev.importance * 2.2) * dpr;
      ctx2d.beginPath();
      ctx2d.arc(cx, y, dotR, 0, Math.PI * 2);
      ctx2d.fillStyle = color;
      ctx2d.globalAlpha = alpha * (isHover ? 1 : 0.85);
      ctx2d.shadowColor = color;
      ctx2d.shadowBlur = (isHover ? 14 : 6) * dpr;
      ctx2d.fill();
      ctx2d.shadowBlur = 0;
      ctx2d.globalAlpha = 1;
    });

    if (!reduceMotion) raf = requestAnimationFrame(frame);
  }
  frame();

  return function destroy() {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseleave', onLeave);
    tip.remove();
  };
}

/* ═══════════════════════════════════════════════════════════════
   CONSCIENCE SEBA (Bible II.7) — notifications prédictives en
   "aura" : n'interrompent jamais (pas de modale, flottent dans un
   coin), deux choix seulement (Valider/Ignorer). Valider = la carte
   se dissout et se "morphe" en Vecteur d'Action (II.4) plutôt que de
   simplement disparaître — la prédiction devient une tâche concrète.
═══════════════════════════════════════════════════════════════ */

/* Structure de données simple pour tester le système — deux scénarios
   d'anticipation, avant tout branchement sur une vraie heuristique. */
const AURA_TEST_SCENARIOS = [
  { message: 'Paiement client X incertain (80% de retard)', probability: 80 },
  { message: 'Planning semaine prochaine à 90% de capacité', probability: 90 },
];

/* Réserve/relâche l'espace en bas du document (audit 1.2) tant que la pile
   Conscience Seba a au moins une carte visible, pour qu'elle ne se retrouve
   jamais superposée aux Vecteurs d'Action une fois la page scrollée en bas.
   QA 2026-07-07 : la classe .has-aura-notifications posait une réserve FIXE de
   260px (dashboard.html), mais .aura-stack peut grandir jusqu'à son max-height
   CSS (46vh, soit ~414px sur un viewport de 900px) dès que 3-4 notifications
   s'accumulent avant d'être traitées (confirmé par mesure : sur 4 cartes, la
   pile occupe bien 414px alors que la réserve restait plafonnée à 260px — un
   vrai recouvrement résiduel). On mesure donc la hauteur réelle de la pile à
   chaque appel et on pose une réserve dynamique (inline, prioritaire sur la
   règle CSS de secours) au lieu d'une valeur devinée. */
function updateAuraReserve() {
  const stack = document.getElementById('aura-stack');
  const main = document.querySelector('.main');
  if (!stack || !main) return;
  const hasCards = !!stack.querySelector('.aura-card');
  main.classList.toggle('has-aura-notifications', hasCards);
  if (hasCards) {
    const h = stack.getBoundingClientRect().height;
    main.style.paddingBottom = Math.max(h + 40, 260) + 'px';
  } else {
    main.style.paddingBottom = '';
  }
}

function showAuraNotification(message, probability) {
  const stack = document.getElementById('aura-stack');
  if (!stack) return null;

  const card = document.createElement('div');
  card.className = 'aura-card';
  card.innerHTML =
    '<div class="aura-badge">' + probability + ' %</div>' +
    '<div class="aura-msg">' + esc(message) + '</div>' +
    '<div class="aura-actions">' +
      '<button class="aura-btn ignore" type="button">Ignorer</button>' +
      '<button class="aura-btn validate" type="button">Valider</button>' +
    '</div>';
  stack.appendChild(card);
  requestAnimationFrame(() => card.classList.add('visible'));
  updateAuraReserve();

  card.querySelector('.ignore').addEventListener('click', () => dismissAuraNotification(card, false, message));
  card.querySelector('.validate').addEventListener('click', () => dismissAuraNotification(card, true, message));
  return card;
}

function dismissAuraNotification(card, validated, message) {
  card.classList.add('leaving');
  card.addEventListener('transitionend', () => {
    card.remove();
    updateAuraReserve();
    if (!validated) return;
    if (window.AudioUI) window.AudioUI.playSuccess();
    /* Morphing : la prédiction devient un Vecteur d'Action réel (II.4).
       On réutilise createActionCard tel quel — seule la matérialisation
       (opacité/scale) est pilotée ici pour vendre l'idée de transformation
       plutôt qu'une simple apparition. */
    const newCard = createActionCard('Passer à l\'action', message);
    if (newCard) {
      newCard.classList.add('materializing');
      requestAnimationFrame(() => requestAnimationFrame(() => newCard.classList.remove('materializing')));
      newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, { once: true });
}

/* Déclenche les scénarios de démonstration, décalés pour rester non
   intrusif (elles n'arrivent pas toutes en même temps à l'ouverture). */
function triggerAuraDemo() {
  AURA_TEST_SCENARIOS.forEach((s, i) => {
    setTimeout(() => showAuraNotification(s.message, s.probability), 2500 + i * 3500);
  });
}

/* ═══════════════════════════════════════════════════════════════
   INJECTION DE L'INTELLIGENCE (Bible V.1) — Conscience Seba branchée
   sur le relais IA unifié. La clé API ne touche JAMAIS le navigateur :
   callSebaAI n'appelle pas les fournisseurs directement, elle appelle
   le relais Supabase Edge Function (supabase-functions/ai-relay.ts)
   qui essaie Mistral → Groq → OpenRouter → Gemini côté serveur — même
   relais que l'assistant conversationnel (ai-assistant.js). Un site
   100% statique ne peut PAS cacher une clé secrète autrement ; c'est
   une contrainte, pas un choix.
═══════════════════════════════════════════════════════════════ */

/* Jeton de session réel — le relais exige un vrai auth.uid() (voir
   ai-relay.ts) pour compter le quota par compte. */
function _sebaAIBearer() {
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

/* Envoie le contexte du dashboard au relais et renvoie la recommandation
   structurée { action, priority, reasoning }, ou null si le relais n'est
   pas configuré ou indisponible (aucune exception ne remonte à l'appelant —
   l'IA est un bonus, jamais un point de blocage du dashboard). */
async function callSebaAI(context) {
  const cfg = window.SEBA_CONFIG || {};
  const bearer = _sebaAIBearer();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !bearer) return null;
  try {
    const res = await fetch(cfg.supabaseUrl + '/functions/v1/ai-relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + bearer },
      body: JSON.stringify({ mode: 'json', context }),
    });
    if (!res.ok) throw new Error('Relais IA HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (!data.action || !data.priority) return null;
    return data;
  } catch (e) {
    console.warn('[Conscience Seba] analyse indisponible :', e.message);
    return null;
  }
}

const SEBA_AI_PRIORITY_PCT = { high: 88, medium: 60, low: 30 };

/* Convertit une recommandation IA en aura (réutilise le II.7 tel quel —
   même "morphing" vers Vecteur d'Action si l'utilisateur valide). */
function presentSebaAIRecommendation(result) {
  if (!result) return;
  const pct = SEBA_AI_PRIORITY_PCT[result.priority] || 50;
  const message = result.action + (result.reasoning ? ' — ' + result.reasoning : '');
  showAuraNotification(message, pct);
}

/* ── Cycle de vie : déclenchement automatique ──────────────────────────
   1) Transition CRITIQUE du Serenity Score (pas à chaque re-rendu — un
      score qui RESTE en alerte ne doit pas spammer l'IA en boucle).
   2) Apparition d'un point "majeur" dans les Lignes d'Horizon (montant
      au-dessus d'un seuil), une seule fois par point (dédoublonné). */
let _lastSerenityState = null;
function maybeTriggerAIOnSerenity(state, wctx) {
  const wasAlert = _lastSerenityState === 'alerte';
  _lastSerenityState = state.key;
  if (state.key !== 'alerte' || wasAlert) return; // seulement l'ENTRÉE en alerte, pas le maintien
  callSebaAI({ source: 'serenity-score', state: state.key, demo: wctx.demo && wctx.demo.metrics })
    .then(presentSebaAIRecommendation);
}

const HORIZON_MAJOR_THRESHOLD = 400; // €, seuil "donnée majeure" — cf. Bible V.1
const _horizonAiSeen = new Set();
function maybeTriggerAIOnHorizon(series, sym) {
  const all = (series.gains || []).concat(series.pending || []);
  const majorPoint = all.find(p => p.amount >= HORIZON_MAJOR_THRESHOLD && !_horizonAiSeen.has(p.date + ':' + p.amount));
  if (!majorPoint) return;
  _horizonAiSeen.add(majorPoint.date + ':' + majorPoint.amount);
  callSebaAI({ source: 'horizon-line', date: majorPoint.date, amount: majorPoint.amount, devise: sym })
    .then(presentSebaAIRecommendation);
}

/* ═══════════════════════════════════════════════════════════════
   WIDGET_CATALOG — cœur (Phase 1/2) + compagnon issus des
   pages-outils (Phase 5). size: S|M|L|XL, category: core|companion.
═══════════════════════════════════════════════════════════════ */
window.WIDGET_CATALOG = {

  'serenity-score': { id: 'serenity-score', title: 'Indice de santé du compte', size: 'L', category: 'core', source: 'live',
    keywords: ['indice de sante', 'score de sante', 'sante entreprise', 'coeur reacteur', 'barometre'],
    defaultVisible: true, defaultOrder: -1,
    render(ctx, el) { renderSerenityScore(ctx, el); } },

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

  'bento-chart': { id: 'bento-chart', title: 'Suivi des encaissements', size: 'L', category: 'core', source: 'demo',
    keywords: ['suivi des encaissements', 'graphique', 'courbe', "évolution ca", 'chiffre d\'affaires'],
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
        '<div class="bc-period-row">' +
        '<button type="button" class="bc-period-btn active" data-period="mois" onclick="switchChartPeriod(\'mois\')">6 mois</button>' +
        '<button type="button" class="bc-period-btn" data-period="jour" onclick="switchChartPeriod(\'jour\')">7 jours</button>' +
        '</div>' +
        '<div class="bc-hdr">' +
        '<div><div class="bc-amount">' + totalFmt + '<span class="bc-u">' + ctx.sym + '</span></div>' +
        '<div class="bc-delta-row"><span class="bc-delta up">↑ ' + deltaLabel + '</span></div></div>' +
        '<span style="font-size:.73rem;color:var(--text-2);">Ce mois · ' + new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) + '</span>' +
        '</div><div class="bc-d3-wrap"></div></div>';
      renderFinanceChartD3(el.querySelector('.bc-d3-wrap'), buildFinanceSeries(ctx.secteur, cur), ctx.sym, tgt);
    } },
  'bento-actions': { id: 'bento-actions', title: 'Actions flash', size: 'L', category: 'core', source: 'static',
    keywords: ['actions flash', 'raccourcis', 'programmer intervention', 'envoyer lien paiement'],
    defaultVisible: true, defaultOrder: 5,
    render(ctx, el) {
      el.innerHTML = '<div class="bento-flash" style="padding:14px;">' +
        '<a href="planning.html" class="flash-btn"><div class="flash-ico"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#00FF9D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="14" height="14" rx="2"/><path d="M3 8h14M8 4V2M12 4V2"/></svg></div><div><span class="flash-txt">Programmer une intervention</span><span class="flash-sub">Créer et assigner en 3 clics</span></div></a>' +
        '<button class="flash-btn" onclick="copyLink(this)"><div class="flash-ico"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#00FF9D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M9 3h8v8"/></svg></div><div><span class="flash-txt">Envoyer un lien de paiement</span><span class="flash-sub">Copier votre lien portail client</span></div></button>' +
        '<a href="devis-nouveau.html" class="flash-btn"><div class="flash-ico"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#00FF9D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/><path d="M8 8h4M8 12h2"/></svg></div><div><span class="flash-txt">Créer un devis</span><span class="flash-sub">Devis signable en 2 minutes</span></div></a></div>';
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
        '<div class="ws-row"><span class="ws-label">Secteur</span><span class="ws-val">' + esc(ctx.sectorLabel) + '</span></div>' +
        '<a href="reglages.html" class="ws-row"><span class="ws-label">Services actifs</span><span class="ws-val link">' + sc + ' service' + (sc !== 1 ? 's' : '') + ' →</span></a>' +
        '<div class="ws-row"><span class="ws-label">Portail</span><span class="ws-val" style="color:#00FF9D">Actif</span></div>' +
        '<div class="ws-row"><span class="ws-label">Pays / Devise</span><span class="ws-val">' + esc(ctx.biz.pays || 'Non renseigné') + ' · ' + esc(ctx.sym) + '</span></div>';
    } },

  'portal': { id: 'portal', title: 'Portail client', size: 'L', category: 'core', source: 'demo',
    keywords: ['portail client', 'lien client', 'partager'],
    defaultVisible: true, defaultOrder: 12,
    render(ctx, el) {
      const publicName = ctx.biz.publicName || ctx.nom;
      const portalUrl = 'seba.app/p/' + ctx.slug;
      const portalCode = 'SEBA-' + ctx.slug.substring(0, 4).toUpperCase();
      el.innerHTML = '<div class="portal-block">' +
        '<div class="portal-name">' + esc(publicName) + '</div>' +
        '<div class="portal-url-txt" id="portal-url">' + esc(portalUrl) + '</div>' +
        '<div class="portal-code-row"><span class="portal-code-lbl">Code d\'accès</span><span class="code-chip">' + esc(portalCode) + '</span></div>' +
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
      if (!list.length) {
        el.innerHTML = buildRichEmptyHTML(
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00FF9D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
          'Rien en retard',
          'Toutes vos factures sont à jour — aucune relance nécessaire pour le moment.'
        );
        return;
      }
      const total = list.reduce((s, c) => s + c.montant, 0);
      el.innerHTML = '<div class="ws-row"><span class="ws-label">' + list.length + ' facture(s) en retard</span><span class="ws-val">' + total.toLocaleString('fr-FR') + ' €</span></div>' +
        list.slice(0, 3).map(c =>
          '<div class="ws-row"><span class="ws-label">' + esc(c.client) + '</span><span class="ws-val" style="color:' + (c.relanceStep >= 2 ? '#FFB800' : '#FFB800') + '">' + (c.montant).toLocaleString('fr-FR') + ' € · ' + (RELANCE_LABELS[c.relanceStep] || '') + '</span></div>'
        ).join('');
    } },

  'lot-pipeline': { id: 'lot-pipeline', title: 'Pipeline devis → facture → encaissé', size: 'XL', category: 'companion', source: 'lot:mutation',
    keywords: ['pipeline', 'devis facture encaissé', 'kanban commercial', 'suivi commercial'],
    defaultVisible: false, defaultOrder: 21, link: { href: 'mutation-contextuelle.html', label: 'Pipeline complet →' },
    render(ctx, el) {
      const docs = ctx.mutationDocs || [];
      if (!docs.length) {
        el.innerHTML = buildRichEmptyHTML(
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00FF9D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16l-6 8v6l-4 2v-8L4 4z"/></svg>',
          'Aucun dossier en cours',
          'Suivez vos devis jusqu\'à l\'encaissement, du premier RDV au paiement.',
          'Créer un RDV', 'mutation-contextuelle.html'
        );
        return;
      }
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
      if (!pts.length) {
        el.innerHTML = buildRichEmptyHTML(
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00FF9D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>',
          'Optimisez vos trajets du jour',
          'Ajoutez vos arrêts et Seba calcule l\'ordre le plus rapide.',
          'Ajouter des points', 'haversine-engine.html'
        );
        return;
      }
      el.innerHTML = '<div class="ws-row"><span class="ws-label">' + pts.length + ' arrêt(s) programmé(s)</span></div>' +
        pts.slice(0, 5).map(p => '<div class="ws-row"><span class="ws-label">' + esc(p.nom) + '</span></div>').join('');
    } },

  'chart-donut': { id: 'chart-donut', title: 'Répartition des interventions', size: 'L', category: 'core', source: 'live',
    keywords: ['répartition', 'donut', 'camembert', 'statuts interventions', 'anneau'],
    defaultVisible: false, defaultOrder: 14,
    render(ctx, el) {
      el.innerHTML = '<div class="donut-wrap" style="display:flex;align-items:center;gap:18px;height:100%;padding:12px 16px;"></div>';
      const wrap = el.querySelector('.donut-wrap');
      if (typeof d3 === 'undefined') { wrap.innerHTML = '<div class="tl-empty">Graphique indisponible.</div>'; return; }
      // Répartition réelle si données, sinon démo plausible
      let data;
      if (window.SebaDB && SebaDB.hasData()) {
        const list = SebaDB.list('interventions');
        const today = new Date(); today.setHours(0,0,0,0);
        const done = list.filter(i => i.done).length;
        const enCours = list.filter(i => !i.done && new Date(i.date) <= today).length;
        const aVenir = list.length - done - enCours;
        data = [
          { label: 'Terminées', value: done, color: '#00FF9D' },
          { label: 'En cours', value: Math.max(enCours, 0), color: '#FFB800' },
          { label: 'À venir', value: Math.max(aVenir, 0), color: 'rgba(255,255,255,.35)' },
        ];
      } else {
        data = [
          { label: 'Terminées', value: 14, color: '#00FF9D' },
          { label: 'En cours', value: 3, color: '#FFB800' },
          { label: 'À venir', value: 6, color: 'rgba(255,255,255,.35)' },
        ];
      }
      const total = data.reduce((s, d) => s + d.value, 0) || 1;
      const size = 140, R = size / 2;
      const svg = d3.select(wrap).append('svg')
        .attr('viewBox', `0 0 ${size} ${size}`).style('width', size + 'px').style('flex-shrink', 0);
      const g = svg.append('g').attr('transform', `translate(${R},${R})`);
      const pie = d3.pie().value(d => d.value).sort(null).padAngle(0.03);
      const arc = d3.arc().innerRadius(R - 22).outerRadius(R - 4).cornerRadius(3);
      g.selectAll('path').data(pie(data)).enter().append('path')
        .attr('fill', d => d.data.color)
        .transition().duration(900).ease(d3.easeCubicOut)
        .attrTween('d', function (d) {
          const i = d3.interpolate({ startAngle: d.startAngle, endAngle: d.startAngle }, d);
          return t => arc(i(t));
        });
      g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.1em')
        .style('font-size', '26px').style('font-weight', '800').style('fill', 'var(--ink)').text(total);
      g.append('text').attr('text-anchor', 'middle').attr('dy', '1.4em')
        .style('font-size', '10px').style('fill', 'var(--text-2)').text('interventions');
      const legend = document.createElement('div');
      legend.innerHTML = data.map(d =>
        '<div style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:.82rem;">' +
        '<span style="width:10px;height:10px;border-radius:3px;background:' + d.color + ';flex-shrink:0;"></span>' +
        '<span style="color:var(--text-2);">' + d.label + '</span>' +
        '<b style="margin-left:auto;">' + d.value + '</b></div>'
      ).join('');
      legend.style.cssText = 'flex:1;min-width:0;';
      wrap.appendChild(legend);
    } },

  'lot-carte': { id: 'lot-carte', title: 'Carte des interventions', size: 'L', category: 'companion', source: 'live',
    keywords: ['carte', 'map', 'tournée sur carte', 'localisation', 'itinéraire carte', 'géolocalisation'],
    defaultVisible: false, defaultOrder: 24, link: { href: 'planning.html', label: 'Planning →' },
    render(ctx, el) {
      /* Audit 2.2 : renderGrid() vide et reconstruit tout #widget-grid à chaque
         bascule du mode personnalisation/ajout de widget — sans ce nettoyage,
         chaque re-rendu créait une NOUVELLE instance L.map() sans jamais
         appeler .remove() sur la précédente (le conteneur DOM disparaissait,
         mais les listeners window/tuiles Leaflet restaient actifs : fuite
         mémoire cumulative). Une seule instance vivante à la fois. */
      if (_lotCarteMapInstance) { try { _lotCarteMapInstance.remove(); } catch (e) {} _lotCarteMapInstance = null; }
      el.innerHTML = '<div class="widget-map" style="height:100%;min-height:150px;border-radius:0 0 var(--r) var(--r);overflow:hidden;"></div>';
      const box = el.querySelector('.widget-map');
      loadLeaflet().then(() => {
        if (!document.body.contains(box)) return; // widget retiré/re-rendu avant la fin du chargement
        const jour = (window.SebaDB && SebaDB.hasData()) ? SebaDB.metrics().interventionsJour : [];
        const map = L.map(box, { zoomControl: false, attributionControl: false }).setView([48.8566, 2.3522], 11);
        _lotCarteMapInstance = map;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
        const pts = jour.length ? jour : [{ clientName: 'Aucune intervention aujourd\'hui', time: '', service: '' }];
        const markers = [];
        pts.forEach((i, idx) => {
          // position pseudo-aléatoire mais STABLE par client (hash du nom) autour du centre
          let h = 0; const s = i.clientName || String(idx);
          for (let c = 0; c < s.length; c++) h = ((h << 5) - h + s.charCodeAt(c)) | 0;
          const lat = 48.8566 + ((h % 1000) / 1000 - 0.5) * 0.12;
          const lng = 2.3522 + (((h >> 10) % 1000) / 1000 - 0.5) * 0.18;
          const m = L.circleMarker([lat, lng], { radius: 9, color: '#00FF9D', weight: 2.5, fillColor: '#00FF9D', fillOpacity: 0.35 }).addTo(map);
          if (i.time) m.bindPopup('<b>' + i.time + '</b> — ' + i.clientName + '<br>' + i.service);
          markers.push(m);
        });
        if (markers.length > 1) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.25));
        setTimeout(() => map.invalidateSize(), 250);
      }).catch(() => {
        box.innerHTML = '<div class="tl-empty">Carte indisponible hors ligne.</div>';
      });
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

  /* ── Bibliothèque d'Extensions (Bible IV.9) — mini-modules ajoutables par
     glisser-déposer depuis le tiroir. defaultVisible:false : n'apparaissent
     que si l'utilisateur les fait glisser dans la grille (ou les coche
     depuis le panneau Personnaliser existant, qui liste aussi cette
     catégorie). ── */
  'ext-chart': { id: 'ext-chart', title: 'Nouveau Graphique', size: 'M', category: 'extension', source: 'extension',
    keywords: ['nouveau graphique', 'graphique personnalisé'],
    defaultVisible: false, defaultOrder: 30,
    render(ctx, el) {
      el.innerHTML = '<div class="ext-placeholder"><div class="ext-ph-ico">📈</div>' +
        '<div class="ext-ph-title">Graphique personnalisé</div>' +
        '<div class="ext-ph-sub">Choisissez une métrique à suivre — configuration à venir.</div></div>';
    } },

  'ext-notes': { id: 'ext-notes', title: 'Bloc-notes', size: 'M', category: 'extension', source: 'extension',
    keywords: ['bloc-notes', 'notes', 'mémo'],
    defaultVisible: false, defaultOrder: 31,
    render(ctx, el) {
      const KEY = 'widget_notes';
      el.innerHTML = '<textarea class="ext-notes-area" placeholder="Notez une idée, un rappel...">' +
        (readSeba(KEY, '') || '') + '</textarea>';
      const area = el.querySelector('.ext-notes-area');
      let t;
      area.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => writeSeba(KEY, area.value), 300);
      });
    } },

  'ext-rss': { id: 'ext-rss', title: 'Flux RSS Finance', size: 'M', category: 'extension', source: 'extension',
    keywords: ['flux rss', 'actualités finance', 'rss finance'],
    defaultVisible: false, defaultOrder: 32,
    render(ctx, el) {
      /* Un site 100% statique ne peut pas interroger un flux RSS externe
         sans proxy serveur (CORS) — aperçu honnête plutôt qu'un faux flux. */
      const items = [
        'Taux BCE inchangés ce trimestre',
        'Inflation : légère baisse en zone euro',
        'PME : nouvelles aides à la trésorerie annoncées',
      ];
      el.innerHTML = '<div class="ext-rss-list">' +
        items.map(t => '<div class="ext-rss-item">' + t + '</div>').join('') +
        '</div><div class="ext-rss-note">Aperçu de démonstration — connexion à un vrai flux RSS nécessite un relais serveur.</div>';
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
   DONNÉES LIVE — quand SebaDB (seba-data.js) contient de vraies
   données, le dashboard calcule ses chiffres depuis le store au lieu
   de la démo statique. Même forme que DEMO[secteur] : zéro changement
   dans les widgets consommateurs.
═══════════════════════════════════════════════════════════════ */
function relativeTime(ts) {
  const diff = Date.now() - ts;
  const h = Math.floor(diff / 3600e3);
  if (h < 1) return 'Il y a ' + Math.max(1, Math.floor(diff / 60e3)) + ' min';
  if (h < 24) return 'Il y a ' + h + 'h';
  const d = Math.floor(h / 24);
  if (d === 1) return 'Hier';
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function buildLiveData(demoFallback, sym) {
  const DB = window.SebaDB;
  const m = DB.metrics();
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const prevKey = prevMonth.getFullYear() + '-' + String(prevMonth.getMonth() + 1).padStart(2, '0');
  const caPrev = DB.list('factures').filter(f => f.status === 'payee' && (f.paidAt || f.date || '').startsWith(prevKey))
    .reduce((s, f) => s + (f.amount || 0), 0);
  const caDelta = caPrev > 0 ? Math.round((m.caMois - caPrev) / caPrev * 100) : null;
  const clientsNouveaux = DB.list('clients').filter(c => {
    const d = new Date(c.createdAt || 0); return (now - d) < 30 * 864e5;
  }).length;
  const devisVieux = DB.list('devis').filter(d => d.status === 'attente' && (now - new Date(d.date)) > 7 * 864e5).length;

  const fmtVal = n => n.toLocaleString('fr-FR');

  return {
    metrics: [
      { label: 'CA ce mois', value: fmtVal(m.caMois), unit: sym,
        delta: caDelta !== null ? (caDelta >= 0 ? '+' : '') + caDelta + '% vs mois der.' : 'encaissé ce mois', up: caDelta === null || caDelta >= 0, href: 'factures.html' },
      { label: 'Interventions', value: String(m.interventionsMois), unit: '',
        delta: m.interventionsJour.length + " aujourd'hui", up: true, href: 'planning.html' },
      { label: 'Clients actifs', value: String(m.clientsActifs), unit: '',
        delta: clientsNouveaux ? '+' + clientsNouveaux + ' ce mois' : 'sur ' + m.clientsTotal + ' clients', up: true, href: 'clients.html' },
      { label: 'Devis en attente', value: String(m.devisAttente), unit: '',
        delta: devisVieux ? devisVieux + ' à relancer' : 'à jour', up: devisVieux === 0, href: 'devis.html' },
    ],
    timeline: m.interventionsJour.map(i => ({
      time: i.time, done: !!i.done, type: 'intervention',
      label: i.service + ' — ' + i.clientName,
      sub: i.done ? 'Terminé' : 'À venir', href: 'planning.html',
    })),
    activity: DB.journal(4).map(e => ({
      type: e.type === 'facture' ? 'paiement' : e.type,
      label: e.label, time: relativeTime(e.ts), href: e.href || 'historique.html',
    })),
    recos: demoFallback.recos,
    team: DB.list('employes').map(e => ({
      name: e.prenom + ' ' + e.nom, role: e.role, working: !!e.actif, href: 'equipe.html',
    })),
    goal: { label: 'CA mensuel', current: m.caMois, target: demoFallback.goal.target || 3500, unit: sym },
  };
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
/* Refonte Tactical Dark (TD-3) : ces 3 widgets sont ancrés dans la zone
   "télémétrie" fixe en haut du cockpit (voir renderCockpitTelemetry
   ci-dessous) — exclus de #widget-grid, donc structurellement hors de
   portée de SortableJS, sans toucher à sa configuration. Le reste du
   catalogue (Bibliothèque d'Extensions incluse) reste 100% modulable. */
const PINNED_TELEMETRY_IDS = ['metric-0', 'serenity-score', 'timeline'];

function renderGrid(gridEl, ctx, customizeMode) {
  const layout = getEffectiveLayout();
  gridEl.innerHTML = '';
  const visible = layout.filter(w => w.visible && !PINNED_TELEMETRY_IDS.includes(w.id));
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

/* Zone télémétrie fixe (Bible V — Cockpit, TD-3) : CA à gauche, Serenity
   Score au centre, Missions du jour à droite — ordre volontaire, pas
   celui de defaultOrder utilisé pour la grille modulable. Jamais de
   drag-handle/bouton de retrait : ces 3 widgets ne sont pas gérés par
   le mode personnalisation. */
function renderCockpitTelemetry(ctx) {
  const container = document.getElementById('cockpit-telemetry');
  if (!container) return;
  container.innerHTML = '';
  PINNED_TELEMETRY_IDS.forEach(id => {
    const def = window.WIDGET_CATALOG[id];
    if (!def) return;
    const shell = document.createElement('div');
    shell.className = 'widget-shell cockpit-pinned';
    shell.dataset.size = def.size;
    shell.dataset.widgetId = id;
    shell.innerHTML = '<div class="module-head"><span class="module-title">' + def.title + '</span></div><div class="widget-body"></div>';
    container.appendChild(shell);
    def.render(ctx, shell.querySelector('.widget-body'));
  });
}
window.renderCockpitTelemetry = renderCockpitTelemetry;

/* ═══════════════════════════════════════════════════════════════
   DRAG-AND-DROP (Phase 4) — SortableJS, actif uniquement en
   mode personnalisation. Boutons clavier monter/descendre en repli.
═══════════════════════════════════════════════════════════════ */
/* ── Drag & Drop Haptique (Bible IV.8) ──────────────────────────────────────
   SortableJS gère uniquement les enfants de #widget-grid (les .widget-shell).
   Le rail de la Timeline de Vie (.timeline-life-rail) est un élément
   position:fixed rendu en dehors de .app, jamais un enfant de la grille —
   il est donc structurellement impossible à saisir par ce Sortable, sans
   exclusion explicite à ajouter. ── */
let _sortableInstance = null;
function initSortable(gridEl) {
  if (typeof Sortable === 'undefined') return;
  if (_sortableInstance) { _sortableInstance.destroy(); _sortableInstance = null; }
  _sortableInstance = Sortable.create(gridEl, {
    handle: '.widget-drag-handle',
    animation: 150,
    easing: 'cubic-bezier(.34,1.56,.64,1)', // léger dépassement = sensation d'aimantation/accélération au snap
    onStart(evt) {
      evt.item.classList.add('is-dragging');
    },
    onEnd(evt) {
      evt.item.classList.remove('is-dragging');
      const ids = Array.from(gridEl.children).map(el => el.dataset.widgetId);
      persistOrder(ids);
      /* Verrouillage : onde lumineuse émeraude sur les bords, puis nettoyage */
      const el = evt.item;
      if (window.AudioUI) window.AudioUI.playClick();
      el.classList.remove('lock-wave'); // relance l'animation même si elle tournait déjà
      void el.offsetWidth; // force le reflow pour redémarrer le keyframe
      el.classList.add('lock-wave');
      el.addEventListener('animationend', () => el.classList.remove('lock-wave'), { once: true });
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
const CATEGORY_LABEL = { core: 'Cœur', companion: 'Compagnon', extension: 'Extensions' };
function buildLibraryPanelHTML() {
  const layout = getEffectiveLayout();
  const byId = {}; layout.forEach(w => byId[w.id] = w);
  const groups = { core: [], companion: [], extension: [] };
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

/* ═══════════════════════════════════════════════════════════════
   BARRE DE COMMANDE IA — burst de particules (Bible I.2)
   Effet ponctuel (pas un système continu comme Serenity/Horizon/
   Timeline) : quand un widget est trouvé, un court éclat de
   particules émeraude traverse la barre pour vendre l'idée de
   "projection" décrite dans la Bible, avant que le widget n'apparaisse
   réellement dans la grille.
═══════════════════════════════════════════════════════════════ */
function aiBarParticleBurst(canvas) {
  if (!canvas) return;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.scale(dpr, dpr);

  const emerald = readThemeVar('--emerald', '#00FF9D');
  const cx = rect.width / 2, cy = 40;
  const N = 22;
  const particles = Array.from({ length: N }, () => ({
    x: cx, y: cy,
    vx: (Math.random() - 0.5) * 5,
    vy: Math.random() * -2 - 1,
    r: Math.random() * 2 + 1,
    life: 1,
  }));

  let raf = null;
  function frame() {
    ctx.clearRect(0, 0, rect.width, rect.height);
    let alive = false;
    particles.forEach(p => {
      if (p.life <= 0) return;
      alive = true;
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.028;
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = emerald;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (alive) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, rect.width, rect.height);
  }
  raf = requestAnimationFrame(frame);
  setTimeout(() => { if (raf) cancelAnimationFrame(raf); ctx.clearRect(0, 0, rect.width, rect.height); }, 1200);
}
window.aiBarParticleBurst = aiBarParticleBurst;
