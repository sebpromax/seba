/* ═══════════════════════════════════════════════════════════════
   SEBA — Moteur Import/Export CSV (100% côté navigateur).
   Import : PapaParse (CDN) lit le fichier localement, mappe les
   colonnes de façon tolérante (prenom/nom/name, email/mail,
   telephone/tel/phone…) et crée les clients via SebaDB.
   Export : SebaDB → CSV → téléchargement direct (Blob).
   Aucune donnée n'est envoyée à un serveur.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* Normalise un nom de colonne pour le matching ("Téléphone " -> "telephone") */
  function normKey(k) {
    return String(k || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  }
  const COL = {
    prenom: ['prenom', 'firstname', 'first'],
    nom: ['nom', 'lastname', 'last', 'name', 'client'],
    email: ['email', 'mail', 'courriel'],
    telephone: ['telephone', 'tel', 'phone', 'mobile', 'portable'],
    adresse: ['adresse', 'address', 'ville', 'city'],
    notes: ['notes', 'note', 'commentaire', 'comments'],
  };
  function pick(row, keys) {
    for (const k of Object.keys(row)) {
      if (keys.includes(normKey(k)) && String(row[k] || '').trim()) return String(row[k]).trim();
    }
    return '';
  }

  window.importerClientsCSV = function (input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (typeof Papa === 'undefined') { toast('Librairie CSV non chargée — vérifiez votre connexion.'); return; }
    toast('Importation en cours…');
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(res) {
        try {
          let ok = 0, ignores = 0;
          res.data.forEach((row) => {
            let prenom = pick(row, COL.prenom);
            let nom = pick(row, COL.nom);
            // "Nom complet" dans une seule colonne → découpage
            if (!prenom && nom && nom.includes(' ')) {
              const parts = nom.split(/\s+/);
              prenom = parts.shift();
              nom = parts.join(' ');
            }
            if (!prenom && !nom) { ignores++; return; }
            const email = pick(row, COL.email);
            const tel = pick(row, COL.telephone);
            SebaDB.create('clients', {
              prenom: prenom || nom, nom: prenom ? nom : '',
              contact: email || tel || '—',
              adresse: pick(row, COL.adresse), notes: pick(row, COL.notes),
              service: 'Importé CSV', ca: 0, statut: 'attente',
            });
            ok++;
          });
          if (ok) SebaDB.log('client', ok + ' client(s) importé(s) depuis CSV', 'clients.html');
          toast(ok + ' client(s) importé(s) avec succès' + (ignores ? ' · ' + ignores + ' ligne(s) ignorée(s)' : ''));
        } catch (e) {
          toast('Import interrompu : ' + e.message);
        }
      },
      error() { toast('Fichier CSV illisible — vérifiez le format.'); },
    });
  };

  window.exporterClientsCSV = function () {
    try {
      const clients = SebaDB.list('clients').map((c) => ({
        prenom: c.prenom, nom: c.nom, contact: c.contact,
        adresse: c.adresse || '', notes: c.notes || '',
        statut: c.statut, ca_total: c.ca || 0, cree_le: c.createdAt || '',
      }));
      if (!clients.length) { toast('Aucun client à exporter.'); return; }
      const csv = typeof Papa !== 'undefined'
        ? Papa.unparse(clients)
        : [Object.keys(clients[0]).join(','), ...clients.map((c) => Object.values(c).map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','))].join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM → accents corrects dans Excel
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'seba-clients-export.csv';
      a.click();
      URL.revokeObjectURL(a.href);
      toast(clients.length + ' client(s) exporté(s) ✓');
    } catch (e) { toast('Export impossible : ' + e.message); }
  };

  function toast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
    else console.log('[Seba CSV]', msg);
  }
})();
