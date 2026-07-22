#!/usr/bin/env bash
# SEBA — destruction complète de l'environnement Supabase local.
# --no-backup : ne conserve aucune donnée locale, destruction totale et
# instantanée, cohérent avec l'usage "jetable" de cet environnement.
set -euo pipefail
npx --yes supabase@2.109.1 stop --no-backup
echo "Environnement Supabase local détruit (aucune donnée conservée)."
