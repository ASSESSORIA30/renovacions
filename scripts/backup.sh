#!/usr/bin/env bash
# =====================================================================================================
# Còpia de seguretat VERIFICABLE de la base de dades de Supabase (Fase 7).
#   Ús:  SUPABASE_DB_URL='postgresql://postgres.<ref>:<contrasenya>@<host>:5432/postgres' ./scripts/backup.sh [carpeta]
# Genera, a la carpeta (per defecte ./backups):
#   - assessoria30-AAAAMMDD-HHMMSS.dump      còpia completa (format custom de pg_dump, comprimida)
#   - assessoria30-AAAAMMDD-HHMMSS.counts    nombre de files de cada taula del projecte en el moment de la còpia
#   - assessoria30-AAAAMMDD-HHMMSS.sha256    empremta per comprovar que el fitxer no s'ha alterat
# La contrasenya NO es guarda enlloc: només és a la variable d'entorn. Els documents (Storage) es copien a part
# (vegeu CRM_FASE7.md · Còpies de seguretat).
# =====================================================================================================
set -euo pipefail
: "${SUPABASE_DB_URL:?Defineix SUPABASE_DB_URL (cadena de connexió de Supabase → Project Settings → Database)}"
OUT="${1:-./backups}"
mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
BASE="$OUT/assessoria30-$STAMP"

echo "→ Comptant files de les taules (public)…"
psql "$SUPABASE_DB_URL" -At -v ON_ERROR_STOP=1 -c "
  select format('select %L as t, count(*) from public.%I;', tablename, tablename)
  from pg_tables where schemaname = 'public' order by tablename" \
  | psql "$SUPABASE_DB_URL" -At -F $'\t' -v ON_ERROR_STOP=1 > "$BASE.counts"

echo "→ Fent la còpia (esquemes public i auth, sense propietaris ni permisos de rol)…"
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges --schema=public --schema=auth --file="$BASE.dump"

echo "→ Comprovant que la còpia es pot llegir…"
pg_restore --list "$BASE.dump" > /dev/null

sha256sum "$BASE.dump" > "$BASE.sha256"
echo "✔ Còpia feta: $BASE.dump ($(du -h "$BASE.dump" | cut -f1)) · $(wc -l < "$BASE.counts") taules comptades"
echo "  Verifica-la restaurant-la en una base de dades de proves: ./scripts/restore-verify.sh $BASE.dump"
