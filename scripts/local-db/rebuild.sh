#!/usr/bin/env bash
# SEBA — reconstruction déterministe de l'environnement Supabase local.
#
# Usage :
#   bash scripts/local-db/rebuild.sh              -> baseline uniquement (supabase-schema.sql)
#   bash scripts/local-db/rebuild.sh --with-rgpd   -> baseline PUIS overlay RGPD explicite
#
# Comportement garanti :
#   - baseline appliqué par défaut, JAMAIS d'overlay implicite ;
#   - affichage explicite quand un overlay est activé ;
#   - arrêt immédiat au premier échec (ON_ERROR_STOP=1 pour psql) ;
#   - code de sortie non nul si un fichier échoue ;
#   - journal sans secret (aucune clé n'est affichée en clair).
set -euo pipefail

WITH_RGPD=false
SHOW_DIFF=false
for arg in "$@"; do
  [[ "$arg" == "--with-rgpd" ]] && WITH_RGPD=true
  [[ "$arg" == "--show-baseline-diff" ]] && SHOW_DIFF=true
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ORDER_FILE="$REPO_ROOT/scripts/local-db/migrations-order.txt"
MANIFEST_FILE="$REPO_ROOT/scripts/local-db/BASELINE_MANIFEST.txt"
SUPABASE_BIN="npx --yes supabase@2.109.1"
PG_CONTAINER="supabase_db_seba"
psql_exec() { docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

# Commande explicite et séparée pour instruire une revalidation volontaire du
# manifeste -- n'écrit JAMAIS le manifeste elle-même, affiche seulement le
# diff et la procédure obligatoire à suivre à la main.
if [[ "$SHOW_DIFF" == "true" ]]; then
  source "$MANIFEST_FILE"
  CURRENT_SHA=$(sha256sum "$REPO_ROOT/$BASELINE_FILE" | cut -d' ' -f1)
  echo "Hash manifeste validé : $BASELINE_SHA256 (commit $BASELINE_COMMIT)"
  echo "Hash actuel du fichier : $CURRENT_SHA"
  if [[ "$CURRENT_SHA" == "$BASELINE_SHA256" ]]; then
    echo "Identique — aucune revalidation nécessaire."
    exit 0
  fi
  echo "=== Diff depuis le commit validé ($BASELINE_COMMIT) ==="
  git -C "$REPO_ROOT" diff "$BASELINE_COMMIT" -- "$BASELINE_FILE"
  echo "=== Revalidation manuelle OBLIGATOIRE avant de mettre à jour le manifeste : ==="
  echo "  1. lire le diff ci-dessus en entier ;"
  echo "  2. reclasser chaque objet touché dans migrations-order.txt (BASELINE/HISTORIQUE ABSORBÉ/OVERLAY) ;"
  echo "  3. exécuter DEUX reconstructions complètes (bash rebuild.sh, deux fois) ;"
  echo "  4. réexécuter verify.sh (et verify-rgpd-overlay.sh si pertinent) ;"
  echo "  5. seulement alors, éditer TOI-MÊME BASELINE_MANIFEST.txt avec ce nouveau hash : $CURRENT_SHA"
  echo "Ce script ne modifie JAMAIS le manifeste automatiquement."
  exit 0
fi

# Extrait les chemins listés sous un marqueur [SECTION] de migrations-order.txt,
# en ignorant les lignes de commentaire (#) et vides.
extract_section() {
  local section="$1"
  awk -v s="[$section]" '
    $0 == s { flag=1; next }
    /^\[/ { flag=0 }
    flag && $0 !~ /^#/ && NF { print }
  ' "$ORDER_FILE"
}

echo "== [0/5] Vérification de provenance du baseline =="
source "$MANIFEST_FILE"
CURRENT_SHA=$(sha256sum "$REPO_ROOT/$BASELINE_FILE" | cut -d' ' -f1)
if [[ "$CURRENT_SHA" != "$BASELINE_SHA256" ]]; then
  echo "!! ARRÊT : $BASELINE_FILE a changé depuis la dernière validation du manifeste."
  echo "   Hash attendu  : $BASELINE_SHA256"
  echo "   Hash actuel   : $CURRENT_SHA"
  echo "   La classification HISTORIQUE ABSORBÉ de migrations-order.txt doit être réauditée."
  echo "   Lancer : bash scripts/local-db/rebuild.sh --show-baseline-diff"
  echo "   Ce script ne poursuit PAS tant que le manifeste n'est pas revalidé manuellement."
  exit 1
else
  echo "   OK — $BASELINE_FILE correspond au manifeste validé ($BASELINE_COMMIT)."
fi

echo "== [1/5] Destruction complète de l'environnement existant (si présent) =="
$SUPABASE_BIN stop --no-backup || echo "   (rien à arrêter, ou déjà arrêté)"

echo "== [2/5] Démarrage d'un environnement vide =="
$SUPABASE_BIN start

echo "== [3/5] Application du BASELINE (obligatoire) =="
count=0
while IFS= read -r line; do
  file="$REPO_ROOT/$line"
  if [[ ! -f "$file" ]]; then
    echo "ERREUR : fichier baseline attendu introuvable : $file"
    exit 1
  fi
  count=$((count + 1))
  echo "   -> Application de : $line"
  if ! psql_exec < "$file" > /tmp/seba-migration-output.log 2>&1; then
    echo "!! ÉCHEC sur le fichier : $line"
    cat /tmp/seba-migration-output.log
    echo "!! Arrêt immédiat — aucune poursuite sur une base partiellement initialisée."
    exit 1
  fi
  echo "      OK"
done < <(extract_section "BASELINE")
echo "   Baseline appliqué avec succès ($count fichier(s))."

echo "== [3bis-a/5] Application des MIGRATIONS PRODUIT (obligatoire, ordonnée) =="
pcount=0
while IFS= read -r line; do
  file="$REPO_ROOT/$line"
  if [[ ! -f "$file" ]]; then
    echo "ERREUR : migration produit attendue introuvable : $file"
    exit 1
  fi
  pcount=$((pcount + 1))
  echo "   -> Application de : $line"
  if ! psql_exec < "$file" > /tmp/seba-product-migration-output.log 2>&1; then
    echo "!! ÉCHEC sur la migration produit : $line"
    cat /tmp/seba-product-migration-output.log
    echo "!! Arrêt immédiat — aucune poursuite sur une base partiellement initialisée."
    exit 1
  fi
  echo "      OK"
done < <(extract_section "PRODUCT-MIGRATIONS")
echo "   Migrations produit appliquées avec succès ($pcount fichier(s))."

echo "== [3ter/5] Grants locaux uniquement (nécessité découverte le 2026-07-22, jamais une migration produit) =="
echo "   Voir scripts/local-db/local-only-grants.sql pour l'explication complète."
if ! psql_exec < "$REPO_ROOT/scripts/local-db/local-only-grants.sql" > /tmp/seba-grants-output.log 2>&1; then
  echo "!! ÉCHEC lors de l'application des grants locaux :"
  cat /tmp/seba-grants-output.log
  exit 1
fi
echo "   OK — privilèges locaux posés (SELECT/INSERT/UPDATE/DELETE authenticated, SELECT anon)."

if [[ "$WITH_RGPD" == "true" ]]; then
  echo "== [3bis/5] OVERLAY RGPD explicitement activé (--with-rgpd) =="
  while IFS= read -r line; do
    file="$REPO_ROOT/$line"
    echo "   ⚠️  APPLICATION D'UN OVERLAY FACULTATIF : $line"
    if ! psql_exec < "$file" > /tmp/seba-overlay-output.log 2>&1; then
      echo "!! ÉCHEC sur l'overlay : $line"
      cat /tmp/seba-overlay-output.log
      echo "!! Arrêt immédiat. L'échec de l'overlay RGPD n'invalide PAS le baseline déjà appliqué."
      exit 1
    fi
    echo "      OK — overlay appliqué."
  done < <(extract_section "OVERLAY-RGPD")
else
  echo "== [3bis/5] Overlay RGPD NON appliqué (par défaut) — relancer avec --with-rgpd pour l'activer =="
fi

echo "== [4/5] Insertion du jeu de données synthétique =="
bash "$REPO_ROOT/scripts/local-db/seed-synthetic.sh"

echo "== [5/5] Reconstruction terminée avec succès. =="
