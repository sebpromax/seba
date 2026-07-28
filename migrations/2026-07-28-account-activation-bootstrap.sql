-- ═══════════════════════════════════════════════════════════════
-- SEBA — Bootstrap de la ligne seba_state du patron à l'inscription
-- (chantier "ACTIVATION RÉELLE DES COMPTES ET ACCÈS", prérequis avant
-- déploiement des emails commerciaux).
--
-- BUG RÉEL TROUVÉ (QA compte/activation, scripts/qa-account-activation.js) :
-- un patron fraîchement inscrit + activé (bienvenue.html -> updatePassword
-- + create_profile_and_company) n'a AUCUNE ligne seba_state -- cette table
-- n'est peuplée que par sync-push (Palier 1, patch par patch), et
-- sync-push.resolveIdentity() EXIGE qu'une ligne seba_state existe déjà
-- pour résoudre account/user_id à partir du JWT (select ... where user_id =
-- callerUid). Résultat : le tout premier SebaDB.create() du patron (ajout
-- d'un client, d'un devis...) échoue silencieusement en boucle (401
-- "Authentification requise", ré-essayé indéfiniment par le worker de
-- sync, jamais résolu) -- un patron neuf ne peut RIEN écrire, et ne peut
-- donc jamais inviter son premier client/employé (client-provision.ts/
-- employe-provision.ts vérifient aussi l'existence de cette même ligne).
--
-- FIX : create_profile_and_company (SECURITY INVOKER, appelée juste après
-- l'activation avec la session du patron déjà active) crée désormais AUSSI
-- la ligne seba_state du patron, avec l'état par défaut exact de EMPTY()
-- (docs/seba-data.js) -- account = user_id = auth.uid(), comme partout
-- ailleurs dans le projet (adapter._accountId()). `on conflict (account) do
-- nothing` : idempotent, sans danger si rejouée (connexion.html rejoue
-- cette RPC au premier login quand la confirmation email était requise,
-- voir completePendingProfile()).
-- ═══════════════════════════════════════════════════════════════

create or replace function create_profile_and_company(
  _user_id uuid,
  _sector text,
  _company_name varchar
) returns uuid as $$
declare
  _profile_id uuid;
begin
  insert into profiles (user_id, sector) values (_user_id, _sector)
    returning id into _profile_id;
  insert into companies (profile_id, name) values (_profile_id, _company_name);

  insert into seba_state (account, user_id, state)
  values (
    _user_id::text,
    _user_id,
    jsonb_build_object(
      'v', 1,
      'clients', '[]'::jsonb, 'devis', '[]'::jsonb, 'factures', '[]'::jsonb,
      'interventions', '[]'::jsonb, 'employes', '[]'::jsonb, 'journal', '[]'::jsonb,
      'custom_services', '[]'::jsonb, 'contrats', '[]'::jsonb, 'messages', '[]'::jsonb,
      'clientRequests', '[]'::jsonb,
      'automationRules', '[]'::jsonb, 'automationRuns', '[]'::jsonb, 'automationAlerts', '[]'::jsonb,
      'entreprise', jsonb_build_object('nom', _company_name, 'secteur', _sector),
      'publicIntakeConfig', null,
      'seq', jsonb_build_object('devis', 118, 'facture', 93, 'contrat', 0, 'recu', 0),
      'documentNumbering', null, 'documentDisplayPrefs', null,
      'commercialEmailTemplates', null
    )
  )
  on conflict (account) do nothing;

  return _profile_id;
end;
$$ language plpgsql;
