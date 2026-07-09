/* ═══════════════════════════════════════════════════════════════
   SEBA — Capture photo terrain + pipeline QA visuelle (Palier 2).

   Appelle supabase-functions/vision-qa.ts (JWT de session, jamais de clé
   secrète côté client — même pattern que email-service.js/push-init.js).
   Ce module ne touche JAMAIS le DOM applicatif : il crée un <input
   type="file"> hors-écran uniquement pour déclencher la caméra native
   (mécanisme HTML5 standard, pas une UI), et renvoie le résultat à
   l'appelant qui décide seul comment l'afficher (badge, toast...).

   Import : <script src="photo-manager.js"></script> en fin de body,
   après config.js (même emplacement que email-service.js/push-init.js).
   Usage :
     const r = await window.sebaPhotoManager.captureAndUpload(interventionId, { onStatus });
     if (r.cancelled) return;
     if (r.error) { /* afficher r.raison, proposer r.retry() si present *\/ return; }
     // r.verdict / r.confidence / r.raison -> tampon de conformite
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const cfg = window.SEBA_CONFIG || {};

  /* Meme extraction que email-service.js/push-init.js : jeton pose par
     supabase-js dans localStorage, jamais une cle secrete. */
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

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* Input fichier hors-ecran, jamais visible : c'est le seul mecanisme
     HTML5 standard pour declencher la camera native en mode "environment"
     (camera arriere) sans dependre d'une lib tierce. Pas une modification
     du DOM applicatif au sens de la contrainte -- retire immediatement
     apres usage. */
  function openCamera() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/webp';
      input.capture = 'environment';
      input.style.position = 'fixed';
      input.style.top = '-9999px';
      input.style.opacity = '0';

      let settled = false;
      const finish = (file) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(file || null);
      };

      input.addEventListener('change', () => finish(input.files && input.files[0]));
      // Support navigateur inegal (Chrome/Edge recents : oui, Safari : variable
      // selon version) -- au pire, une annulation sans evenement 'cancel' laisse
      // simplement la promesse en attente jusqu'a un prochain choix de
      // l'utilisateur ; pas de blocage silencieux ni de plantage.
      input.addEventListener('cancel', () => finish(null));

      document.body.appendChild(input);
      input.click();
    });
  }

  async function uploadOnce(file, interventionId, bearer) {
    const form = new FormData();
    form.append('image_blob', file, file.name || 'intervention.jpg');
    form.append('intervention_id', interventionId);

    // PAS de Content-Type manuel : fetch derive automatiquement
    // "multipart/form-data; boundary=..." depuis FormData -- le forcer
    // casse le parsing multipart cote serveur (form.get() ne trouve plus
    // rien dans vision-qa.ts).
    const res = await fetch(cfg.supabaseUrl + '/functions/v1/vision-qa', {
      method: 'POST',
      headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + bearer },
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!data) throw new Error('Reponse invalide du serveur (HTTP ' + res.status + ')');
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      // Erreurs definitives (session expiree, quota atteint) : jamais la
      // peine de reessayer automatiquement, on remonte tout de suite.
      throw Object.assign(new Error(data.error || ('HTTP ' + res.status)), { permanent: true });
    }
    return data; // { verdict, confidence, raison, error } -- vision-qa.ts renvoie toujours un JSON propre, meme en cas d'echec IA interne
  }

  /* Retry simple, EN MEMOIRE UNIQUEMENT (le File capture reste dans cette
     fermeture) : 3 tentatives, backoff court. Ne survit pas a un
     rechargement de page -- une file d'attente durable (IndexedDB, le blob
     ne tient pas dans localStorage sans le degrader) est hors perimetre
     ici ("logique simple" demandee), a construire separement si le besoin
     de survivre a une coupure longue/un rechargement se confirme. */
  async function runUpload(file, interventionId, onStatus) {
    const bearer = sessionBearer(); // re-lu a chaque tentative : une session rafraichie entre deux essais doit etre prise en compte
    if (!bearer) {
      return { error: true, raison: 'Session expirée, reconnectez-vous pour utiliser la QA visuelle.' };
    }
    onStatus('uploading');
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try {
        onStatus(i === 0 ? 'analyzing' : 'retrying');
        const result = await uploadOnce(file, interventionId, bearer);
        onStatus('done');
        return result;
      } catch (e) {
        lastErr = e;
        if (e.permanent) break;
        if (i < 2) await sleep([1000, 2500][i]);
      }
    }
    onStatus('error');
    // La photo n'est jamais perdue : file reste capture dans cette
    // fermeture, retry() relance exactement le meme upload sans redemander
    // la camera.
    return {
      error: true,
      raison: 'Échec après plusieurs tentatives : ' + lastErr.message,
      retry: () => runUpload(file, interventionId, onStatus),
    };
  }

  window.sebaPhotoManager = {
    /**
     * Ouvre la camera, envoie la photo a vision-qa.ts, retourne le
     * verdict. Ne modifie jamais le DOM applicatif ni n'affiche de
     * notification -- l'appelant recoit le resultat et decide de l'UI
     * (badge de conformite, toast d'erreur, etc.).
     * @param {string} interventionId
     * @param {{ onStatus?: (status: string) => void }} [opts]
     *   onStatus recoit : 'capturing' | 'uploading' | 'analyzing' |
     *   'retrying' | 'done' | 'error'. Optionnel, pour piloter un etat de
     *   chargement ("Analyse en cours...") sans bloquer l'UI principale.
     * @returns {Promise<{cancelled:true} | {error:true, raison:string, retry?:Function} | {verdict:string, confidence:number, raison:string, error:false}>}
     */
    async captureAndUpload(interventionId, opts) {
      const onStatus = (opts && opts.onStatus) || function () {};

      if (!interventionId || typeof interventionId !== 'string') {
        return { error: true, raison: 'intervention_id manquant.' };
      }
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return { error: true, raison: 'QA visuelle indisponible (mode démo, Supabase non configuré).' };
      }
      if (!sessionBearer()) {
        return { error: true, raison: 'Connectez-vous pour utiliser la QA visuelle.' };
      }

      onStatus('capturing');
      const file = await openCamera();
      if (!file) return { cancelled: true };

      return runUpload(file, interventionId, onStatus);
    },
  };
})();
