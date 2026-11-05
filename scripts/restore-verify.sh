#!/usr/bin/env bash
# =====================================================================================================
# Verificació de restauració (Fase 7): restaura una còpia en una base de dades BUIDA DE PROVES i compara el
# nombre de files de cada taula amb el que es va comptar en fer la còpia. MAI contra la base de dades de producció.
#   Ús:  RESTORE_DB_URL='postgresql://…/proves' ./scripts/restore-verify.sh backups/assessoria30-AAAAMMDD-HHMMSS.dump
# =====================================================================================================
set -euo pipefail
DUMP="${1:?Indica el fitxer .dump}"
: "${RESTORE_DB_URL:?Defineix RESTORE_DB_URL (una base de dades de PROVES, buida)}"
BASE="${DUMP%.dump}"
if [[ -n "${SUPABASE_DB_URL:-}" && "$RESTORE_DB_URL" == "$SUPABASE_DB_URL" ]]; then echo "✘ RESTORE_DB_URL no pot ser la base de dades de producció" >&2; exit 1; fi

echo "→ Comprovant l'empremta…"
sha256sum -c "$BASE.sha256"

TABLES="$(psql "$RESTORE_DB_URL" -At -c "select count(*) from pg_tables where schemaname in ('public','auth')")"
if [[ "$TABLES" != "0" ]]; then echo "✘ La base de dades de proves no és buida ($TABLES taules): fes servir una base de dades nova" >&2; exit 1; fi

echo "→ Preparant la base de dades de proves (rols de Supabase i extensions)…"
psql "$RESTORE_DB_URL" -q -v ON_ERROR_STOP=1 -c "
  do \$\$ begin
    begin create role anon; exception when duplicate_object then null; end;
    begin create role authenticated; exception when duplicate_object then null; end;
    begin create role service_role; exception when duplicate_object then null; end;
  end \$\$;
  create extension if not exists pgcrypto; create extension if not exists pg_trgm;"

echo "→ Restaurant a la base de dades de proves…"
# l'esquema public ja existeix a qualsevol base de dades nova: s'omet la seva creació de la llista de restauració
LIST="$(mktemp)"; trap 'rm -f "$LIST"' EXIT
pg_restore --list "$DUMP" | grep -v " SCHEMA - public " > "$LIST"
pg_restore --no-owner --no-privileges --exit-on-error --use-list="$LIST" --dbname="$RESTORE_DB_URL" "$DUMP"

echo "→ Comparant el nombre de files…"
FAIL=0
while IFS=$'\t' read -r table expected; do
  got="$(psql "$RESTORE_DB_URL" -At -c "select count(*) from public.\"$table\"")"
  if [[ "$got" != "$expected" ]]; then echo "✘ $table: esperades $expected, restaurades $got"; FAIL=1; fi
done < "$BASE.counts"
if [[ $FAIL -eq 0 ]]; then echo "✔ Restauració verificada: totes les taules tenen el mateix nombre de files"; else exit 1; fi
