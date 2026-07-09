-- ═══════════════════════════════════════════════════════════════
-- SEBA — Test de non-régression multi-tenant pour client_memoire.
--
-- Contrairement aux Deno.test de supabase-functions/_shared/*.test.ts
-- (qui vérifient un CONTRAT TypeScript via un client Supabase mocké,
-- jamais la RLS elle-même — limite documentée dans chacun de ces
-- fichiers), ceci teste la garantie RLS RÉELLE que client_memoire est
-- censée fournir. Aucun mock ne peut remplacer ça : il faut un vrai
-- Postgres. Pas exécutable dans cet environnement (pas de connexion
-- Postgres/Supabase ici) mais, contrairement aux Deno.test, ce script
-- N'A PAS besoin du CLI Deno — il est directement collable dans
-- Supabase → SQL Editor → New query → Run, dès que client_memoire
-- (20260709_create_client_memoire.sql) a été déployée.
--
-- Principe : crée 2 faux comptes + 1 ligne qa_photos chacun, simule la
-- session du compte A (set local role authenticated + JWT), vérifie que
-- client_memoire ne renvoie QUE la ligne du compte A. Aucune ligne
-- auth.users nécessaire : ni seba_state.user_id, ni qa_photos.user_id
-- n'ont de contrainte FK vers auth.users dans ce schéma (vérifié dans
-- supabase-schema.sql) — auth.uid() lit uniquement le JWT simulé
-- ci-dessous, pas une table.
--
-- `rollback` final : AUCUNE trace laissée en base, sûr à relancer autant
-- de fois que nécessaire, y compris sur un projet avec de vraies données.
-- ═══════════════════════════════════════════════════════════════

begin;

insert into seba_state (account, user_id, state) values
  ('test_compte_a', '00000000-0000-0000-0000-00000000000a', '{}'),
  ('test_compte_b', '00000000-0000-0000-0000-00000000000b', '{}')
on conflict (account) do nothing;

insert into qa_photos (account, user_id, intervention_id, verdict, raison) values
  ('test_compte_a', '00000000-0000-0000-0000-00000000000a', 'id_test_a1', 'conforme', 'Intervention compte A'),
  ('test_compte_b', '00000000-0000-0000-0000-00000000000b', 'id_test_b1', 'conforme', 'Intervention compte B');

-- Simule la session HTTP du compte A (role authenticated + auth.uid()).
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  v_count_own int;
  v_count_other int;
begin
  select count(*) into v_count_own from client_memoire where intervention_id = 'id_test_a1';
  select count(*) into v_count_other from client_memoire where intervention_id = 'id_test_b1';

  assert v_count_own = 1,
    'ECHEC : le compte A ne voit pas sa propre intervention via client_memoire (attendu 1 ligne, trouve ' || v_count_own || ')';
  assert v_count_other = 0,
    'ECHEC MULTI-TENANT : le compte A voit une intervention du compte B via client_memoire (trouve ' || v_count_other || ' ligne(s), attendu 0)';

  raise notice 'OK — isolation multi-tenant verifiee : le compte A voit sa propre intervention et ne voit jamais celle du compte B.';
end $$;

reset role;
rollback; -- annule TOUTES les insertions de test ci-dessus, aucune trace laissee en base
