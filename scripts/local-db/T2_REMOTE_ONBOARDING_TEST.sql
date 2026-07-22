begin;

-- Validation 1 : l'email doit exister exactement une fois dans auth.users.
do $$
declare
  v_count int;
begin
  select count(*) into v_count from auth.users where email = 'TON_EMAIL_DE_TEST_ICI';
  if v_count <> 1 then
    raise exception 'Email introuvable ou en double dans auth.users (trouve: % occurrence(s)) -- arret, aucune donnee touchee.', v_count;
  end if;
end $$;

select set_config('seba_test.user_id', (select id::text from auth.users where email = 'TON_EMAIL_DE_TEST_ICI'), true);

-- Validation 2 : ce compte ne doit avoir ni profil ni entreprise existants.
-- Aucune suppression n'est effectuee ici : si la condition echoue, le
-- script s'arrete, la transaction avorte, rien n'est modifie.
do $$
declare
  v_profile_count int;
  v_company_count int;
begin
  select count(*) into v_profile_count from profiles where user_id = current_setting('seba_test.user_id')::uuid;
  select count(*) into v_company_count from companies where profile_id in (
    select id from profiles where user_id = current_setting('seba_test.user_id')::uuid
  );
  if v_profile_count <> 0 or v_company_count <> 0 then
    raise exception 'Ce compte possede deja % profil(s) et % entreprise(s) -- arret, aucune donnee supprimee ni modifiee. Utilise un compte neuf.', v_profile_count, v_company_count;
  end if;
end $$;

-- Simule l'identite de ce compte (aucun mot de passe requis).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('seba_test.user_id'), 'role', 'authenticated')::text,
  true
);

-- TEST 1, TEST 2, TEST 3 + assertions bloquantes. Toute assertion echouee
-- (RAISE EXCEPTION) abandonne la transaction -- COMMIT en fin de script
-- devient alors un ROLLBACK automatique (comportement standard Postgres
-- sur une transaction avortee).
do $$
declare
  v_test1_id uuid;
  v_test2_id uuid;
  v_profile_count int;
  v_company_count int;
begin
  -- TEST 1 : onboarding avec 'menage'.
  v_test1_id := create_profile_and_company(
    current_setting('seba_test.user_id')::uuid,
    'menage',
    'Entreprise Test T2'
  );
  raise notice 'TEST 1 : profil cree, id=%', v_test1_id;

  -- TEST 2 : meme appel identique -- doit renvoyer EXACTEMENT le meme id.
  v_test2_id := create_profile_and_company(
    current_setting('seba_test.user_id')::uuid,
    'menage',
    'Entreprise Test T2'
  );
  raise notice 'TEST 2 : id retourne=%', v_test2_id;

  if v_test1_id is distinct from v_test2_id then
    raise exception 'ASSERTION ECHOUEE : TEST 1 (id=%) et TEST 2 (id=%) devraient renvoyer le meme id -- doublon possible.', v_test1_id, v_test2_id;
  end if;
  raise notice 'ASSERTION OK : TEST 1 et TEST 2 renvoient le meme id (%).', v_test1_id;

  -- Assertion bloquante : exactement 1 profil et 1 entreprise apres TEST 1 + TEST 2.
  select count(*) into v_profile_count from profiles where user_id = current_setting('seba_test.user_id')::uuid;
  select count(*) into v_company_count from companies where profile_id = v_test1_id;
  if v_profile_count <> 1 or v_company_count <> 1 then
    raise exception 'ASSERTION ECHOUEE apres TEST 2 : % profil(s), % entreprise(s) -- attendu 1 et 1.', v_profile_count, v_company_count;
  end if;
  raise notice 'ASSERTION OK apres TEST 2 : 1 profil, 1 entreprise.';

  -- TEST 3 : secteur different -- doit echouer EXACTEMENT avec SQLSTATE
  -- 23514 (conflit de secteur, seule erreur consideree comme un rejet
  -- attendu). Toute autre SQLSTATE est relancee telle quelle (erreur
  -- technique reelle, jamais interpretee a tort comme un rejet attendu).
  begin
    perform create_profile_and_company(
      current_setting('seba_test.user_id')::uuid,
      'conciergerie',
      'Autre Entreprise'
    );
    raise exception 'ASSERTION ECHOUEE : TEST 3 aurait du etre rejete (SQLSTATE 23514) mais a reussi -- secteur ecrase silencieusement.';
  exception
    when sqlstate '23514' then
      raise notice 'TEST 3 : rejet attendu confirme (SQLSTATE 23514) -- %', sqlerrm;
    when others then
      raise notice 'TEST 3 : erreur INATTENDUE (SQLSTATE %), relance sans etre traitee comme un rejet attendu -- %', sqlstate, sqlerrm;
      raise;
  end;

  -- Assertion bloquante finale : toujours exactement 1 profil et 1
  -- entreprise (TEST 3 n'a rien du modifier).
  select count(*) into v_profile_count from profiles where user_id = current_setting('seba_test.user_id')::uuid;
  select count(*) into v_company_count from companies where profile_id = v_test1_id;
  if v_profile_count <> 1 or v_company_count <> 1 then
    raise exception 'ASSERTION ECHOUEE apres TEST 3 : % profil(s), % entreprise(s) -- attendu 1 et 1 (TEST 3 n''aurait rien du modifier).', v_profile_count, v_company_count;
  end if;
  raise notice 'ASSERTION OK apres TEST 3 : 1 profil, 1 entreprise (inchange).';

  raise notice 'TOUTES LES ASSERTIONS DU BLOC 3 SONT PASSEES.';
end $$;

-- Aucune suppression finale : le compte Auth, le profil et l'entreprise
-- créés par ce test restent intacts.

commit;
