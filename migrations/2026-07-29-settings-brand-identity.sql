-- ═══════════════════════════════════════════════════════════════
-- SEBA — SETTINGS-BRAND-001 : identité de marque réelle (couleur + logo)
-- (défaut confirmé : reglages.html/Identité visuelle affichait un
-- sélecteur de couleur et un input fichier qui ne sauvegardaient
-- réellement rien -- le bouton "Enregistrer" se contentait d'un toast
-- optimiste, aucune requête réseau).
--
-- SOURCE CANONIQUE : reste seba_state.state.entreprise (même objet que
-- nom/email/téléphone/..., migrations/2026-07-29-update-my-entreprise.sql)
-- -- pas de nouvelle table, pas de deuxième source de vérité. Ajoute
-- simplement "branding" (objet imbriqué {accent, logoUrl}) à l'allowlist
-- déjà en place sur update_my_entreprise().
--
-- 1) update_my_entreprise() : accepte désormais la clé "branding".
-- 2) Bucket Storage "company-logos" (public, logos non sensibles par
--    nature -- réutilisé plus tard par PUBLIC-CARD-001) : un patron ne
--    peut écrire que dans son propre dossier ({auth.uid()}/...), lecture
--    publique (même modèle que le bucket sera consommé par une future
--    carte publique).
-- ═══════════════════════════════════════════════════════════════

create or replace function public.update_my_entreprise(p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_new jsonb;
  v_allowed_keys text[] := array['nom', 'email', 'telephone', 'zone', 'raisonSociale', 'siret', 'tvaNumero', 'branding'];
  v_branding_allowed_keys text[] := array['accent', 'logoUrl'];
  v_key text;
begin
  if auth.uid() is null then
    raise exception 'update_my_entreprise: authentification requise'
      using errcode = '42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'update_my_entreprise: patch invalide (objet requis)'
      using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed_keys)) then
      raise exception 'update_my_entreprise: propriété inconnue ''%''', v_key
        using errcode = '22023';
    end if;
  end loop;

  if p_patch ? 'nom' then
    if p_patch ->> 'nom' is null or btrim(p_patch ->> 'nom') = '' then
      raise exception 'update_my_entreprise: le nom de l''entreprise ne peut pas être vide'
        using errcode = '22023';
    end if;
    if length(p_patch ->> 'nom') > 200 then
      raise exception 'update_my_entreprise: nom trop long (200 caractères maximum)'
        using errcode = '22023';
    end if;
  end if;

  if (p_patch ->> 'email') is not null and length(p_patch ->> 'email') > 254 then
    raise exception 'update_my_entreprise: email trop long' using errcode = '22023';
  end if;
  if (p_patch ->> 'telephone') is not null and length(p_patch ->> 'telephone') > 40 then
    raise exception 'update_my_entreprise: telephone trop long' using errcode = '22023';
  end if;
  if (p_patch ->> 'zone') is not null and length(p_patch ->> 'zone') > 200 then
    raise exception 'update_my_entreprise: zone trop longue' using errcode = '22023';
  end if;
  if (p_patch ->> 'raisonSociale') is not null and length(p_patch ->> 'raisonSociale') > 200 then
    raise exception 'update_my_entreprise: raison sociale trop longue' using errcode = '22023';
  end if;
  if (p_patch ->> 'siret') is not null and length(p_patch ->> 'siret') > 40 then
    raise exception 'update_my_entreprise: siret trop long' using errcode = '22023';
  end if;
  if (p_patch ->> 'tvaNumero') is not null and length(p_patch ->> 'tvaNumero') > 40 then
    raise exception 'update_my_entreprise: numero de TVA trop long' using errcode = '22023';
  end if;

  -- SETTINGS-BRAND-001 : "branding" est un objet imbriqué, jamais une
  -- valeur scalaire -- même allowlist stricte à l'intérieur (accent =
  -- couleur hexadécimale exacte, jamais de CSS arbitraire ; logoUrl =
  -- texte, longueur raisonnable, jamais interprété/exécuté nulle part
  -- côté serveur).
  if p_patch ? 'branding' then
    if jsonb_typeof(p_patch -> 'branding') <> 'object' then
      raise exception 'update_my_entreprise: branding invalide (objet requis)'
        using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(p_patch -> 'branding') loop
      if not (v_key = any (v_branding_allowed_keys)) then
        raise exception 'update_my_entreprise: propriété de branding inconnue ''%''', v_key
          using errcode = '22023';
      end if;
    end loop;
    if (p_patch -> 'branding' ->> 'accent') is not null
       and (p_patch -> 'branding' ->> 'accent') !~ '^#[0-9a-fA-F]{6}$' then
      raise exception 'update_my_entreprise: couleur de marque invalide (format #RRGGBB requis)'
        using errcode = '22023';
    end if;
    if (p_patch -> 'branding' ->> 'logoUrl') is not null
       and length(p_patch -> 'branding' ->> 'logoUrl') > 600 then
      raise exception 'update_my_entreprise: URL de logo trop longue' using errcode = '22023';
    end if;
  end if;

  update public.seba_state
  set state = jsonb_set(state, '{entreprise}', coalesce(state -> 'entreprise', '{}'::jsonb) || p_patch, true),
      updated_at = now()
  where user_id = auth.uid()
  returning state -> 'entreprise' into v_new;

  if v_new is null then
    raise exception 'update_my_entreprise: compte introuvable pour cet utilisateur'
      using errcode = '22023';
  end if;

  return v_new;
end;
$$;

revoke all on function public.update_my_entreprise(jsonb) from public;
revoke all on function public.update_my_entreprise(jsonb) from anon;
grant execute on function public.update_my_entreprise(jsonb) to authenticated;

-- ── Bucket Storage pour les logos d'entreprise ─────────────────────
-- Public : un logo d'entreprise n'est pas une donnée sensible, et
-- PUBLIC-CARD-001 (carte publique, backlog) en aura de toute façon
-- besoin en lecture publique plus tard. 3 Mo max, PNG/JPEG/WebP
-- uniquement -- SVG volontairement exclu (peut embarquer du script,
-- nécessite une analyse de sécurité dédiée avant d'être autorisé).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 3145728, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- Convention de chemin : {auth.uid()}/logo.<ext> -- un seul logo par
-- compte, l'upload suivant remplace le précédent (upsert applicatif).
-- Aucune jointure vers une autre table nécessaire ici (contrairement à
-- mission-photos) : le "propriétaire" d'un chemin EST directement
-- auth.uid(), donc pas besoin d'un helper SECURITY DEFINER.
drop policy if exists "company_logos_insert_own" on storage.objects;
create policy "company_logos_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "company_logos_update_own" on storage.objects;
create policy "company_logos_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'company-logos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'company-logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "company_logos_delete_own" on storage.objects;
create policy "company_logos_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'company-logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Lecture publique (bucket public) : nécessaire pour l'accès authentifié
-- via l'API Storage (l'URL publique directe /object/public/... contourne
-- déjà RLS pour un bucket public, cette policy couvre les autres accès).
drop policy if exists "company_logos_select_public" on storage.objects;
create policy "company_logos_select_public" on storage.objects
  for select to public
  using (bucket_id = 'company-logos');
