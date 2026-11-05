import "server-only";
/**
 * Servei SIPS de la plataforma: motor de cups2 + memòria cau a Supabase (`sips_cache`).
 *
 * - Les credencials del portal només existeixen aquí (variables d'entorn del servidor).
 * - `sips_cache` té RLS activat i sense polítiques per a anon/authenticated: només s'hi accedeix
 *   amb la service role DESPRÉS de validar permisos de l'usuari.
 * - Mai s'esborren dades bones per un error del portal; les dades manuals (CRM, factures) són
 *   en taules pròpies i aquest servei no les toca.
 */
import { sipsQuery, entitiesToRows, consumptionFromEntities, login as sipsLogin, SipsError, type SearchInput } from "@/energy/lib/sips-engine";
import { cacheRowFromRecord, cupsBase, emptyRow, isFresh, legacyRow, recordFromRow, SUMMARY_COLUMNS, LEGACY_SUMMARY_COLUMNS, type SipsCacheRow, type SipsSummary } from "@/energy/lib/sips-record";
import { isValidCups, normalizedCups } from "@/core/sips";
import type { Role } from "@/core/types";
import { sipsEnv } from "./env";
import { adminClient, HttpError, requireUser } from "./supabase";

type User = Awaited<ReturnType<typeof requireUser>>;

const isMissingColumn = (e: { message?: string } | null) => !!e && /column|schema cache|does not exist/i.test(e.message ?? "");
const isMissingTable = (e: { message?: string } | null) => !!e && /relation|does not exist|schema cache|not find/i.test(e.message ?? "");

export function sipsConfig() {
  const e = sipsEnv();
  return { base: e.base, user: e.user, pass: e.pass };
}

/** Variables d'entorn que falten per connectar amb el portal SIPS (mai se'n retorna el valor). */
export function sipsMissing(): string[] {
  const e = sipsEnv();
  return [!e.user && "SIPS_USER", !e.pass && "SIPS_PASSWORD"].filter(Boolean) as string[];
}

/**
 * Prova REAL de connexió: inicia sessió al portal amb les credencials del servidor (sense consultar cap CUPS).
 * Retorna només l'estat i un missatge entenedor; mai credencials ni respostes internes del portal.
 */
export async function sipsConnectionTest(f: typeof fetch = fetch): Promise<{ ok: boolean; code: string; message: string; base: string; ms: number; missing: string[] }> {
  const e = sipsEnv();
  const missing = sipsMissing();
  const host = (() => { try { return new URL(e.base).host; } catch { return e.base; } })();
  if (missing.length) return { ok: false, code: "no_configurat", message: `Falten variables d'entorn a Vercel: ${missing.join(", ")}.`, base: host, ms: 0, missing };
  const t0 = Date.now();
  try {
    await sipsLogin(e.base, e.user, e.pass, f);
    return { ok: true, code: "ok", message: "Connexió correcta: el portal SIPS ha acceptat l'usuari i la contrasenya.", base: host, ms: Date.now() - t0, missing };
  } catch (err) {
    const se = err instanceof SipsError ? err : null;
    return { ok: false, code: se?.code ?? "consulta", message: se?.message ?? "No s'ha pogut connectar amb el portal SIPS.", base: host, ms: Date.now() - t0, missing };
  }
}

/* ------------------------------------------------------------------ permisos */

export function canSearchExternal(role: Role) {
  return sipsEnv().externalRoles.includes(role);
}

/** CUPS (base 20) visibles per a l'usuari segons RLS de `contracts`. */
export async function visibleCupsSet(sb: User["sb"]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("contracts").select("cups").range(from, from + 999);
    if (error) throw error;
    for (const c of data ?? []) {
      const k = normalizedCups(c.cups);
      if (k) out.add(k.slice(0, 20));
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export async function isCupsVisible(sb: User["sb"], base: string): Promise<boolean> {
  if (!/^ES\d{16}[A-Z]{2}$/.test(base)) return false;
  // Fase 8: també els subministraments del CRM (Clients 360°) que l'usuari pot veure per RLS, no només la cartera antiga
  const [legacy, crm] = await Promise.all([
    sb.from("contracts").select("id").ilike("cups", `${base}%`).limit(1),
    sb.from("crm_supplies").select("id").eq("cups20", base).is("archived_at", null).limit(1),
  ]);
  if (legacy.error) throw legacy.error;
  return (legacy.data ?? []).length > 0 || (!crm.error && (crm.data ?? []).length > 0);
}

/** Accés a un CUPS concret: és d'un contracte visible, o l'usuari té permís per a subministraments externs. */
export async function assertCupsAccess(u: User, base: string) {
  if (await isCupsVisible(u.sb, base)) return { inCrm: true };
  if (canSearchExternal(u.profile.role)) return { inCrm: false };
  throw new HttpError(403, "Aquest CUPS no correspon a cap contracte que puguis veure.");
}

/* ------------------------------------------------------------- auditoria i límits */

export async function audit(u: Pick<User, "user" | "profile"> | null, action: string, query: unknown, resultCount: number | null, ok: boolean, error?: string) {
  const { error: e } = await adminClient()
    .from("sips_audit")
    .insert({ user_id: u?.user.id ?? null, user_email: u?.profile.email ?? null, action, query, result_count: resultCount, ok, error: error?.slice(0, 500) ?? null });
  if (e && !isMissingTable(e)) console.warn("[sips] no s'ha pogut registrar l'auditoria:", e.message);
}

/** Límit de freqüència per usuari (finestra d'un minut) basat en `sips_audit` (funciona a Vercel sense estat). */
export async function rateLimit(u: User, actions: string[], max: number) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await adminClient().from("sips_audit").select("id", { count: "exact", head: true }).eq("user_id", u.user.id).in("action", actions).gte("at", since);
  if (error) {
    if (!isMissingTable(error)) console.warn("[sips] límit no verificat:", error.message);
    return;
  }
  if ((count ?? 0) >= max) throw new HttpError(429, `Has arribat al límit de ${max} consultes SIPS per minut. Torna-ho a provar d'aquí a una estona.`);
}

/* ------------------------------------------------------------------ memòria cau */

export async function readCache(keys: string[], full = false): Promise<(SipsSummary & { raw?: Record<string, unknown> | null })[]> {
  const sb = adminClient();
  const out: (SipsSummary & { raw?: Record<string, unknown> | null })[] = [];
  let cols = full ? `${SUMMARY_COLUMNS},raw` : SUMMARY_COLUMNS;
  for (let i = 0; i < keys.length; i += 150) {
    const slice = keys.slice(i, i + 150);
    let r = await sb.from("sips_cache").select(cols).in("cups", slice);
    if (r.error && isMissingColumn(r.error)) {
      cols = LEGACY_SUMMARY_COLUMNS; // migració 004 pendent
      r = await sb.from("sips_cache").select(cols).in("cups", slice);
    }
    if (r.error) throw r.error;
    out.push(...((r.data ?? []) as unknown as SipsSummary[]));
  }
  return out;
}

async function upsertRow(row: SipsCacheRow) {
  const sb = adminClient();
  const { error } = await sb.from("sips_cache").upsert(row, { onConflict: "cups" });
  if (!error) return;
  if (isMissingColumn(error)) {
    console.warn("[sips] sips_cache sense les columnes de la migració 004: es desa només el resum");
    const r = await sb.from("sips_cache").upsert(legacyRow(row), { onConflict: "cups" });
    if (r.error) throw r.error;
    return;
  }
  throw error;
}

/** Desa el resultat d'un error sense perdre dades bones anteriors. */
async function recordError(base: string, old: Partial<SipsCacheRow> & { attempts?: number } | null, message: string) {
  const sb = adminClient();
  const attempts = (old?.attempts ?? 0) + 1;
  const retryH = Math.min(sipsEnv().errorRetryHours * 2 ** (attempts - 1), 168);
  const next = new Date(Date.now() + retryH * 3_600_000).toISOString();
  if (old && old.status === "found") {
    const { error } = await sb.from("sips_cache").update({ error: message, attempts, next_retry_at: next, last_error_at: new Date().toISOString() }).eq("cups", base);
    if (error && !isMissingColumn(error)) throw error;
    if (error) await sb.from("sips_cache").update({ error: message }).eq("cups", base);
    return { ...(old as SipsCacheRow), error: message };
  }
  const row = emptyRow(base, "error", message, new Date().toISOString(), { source: "sips", sourceDetail: "Portal SIPS · EAS Renovae" });
  await upsertRow(row);
  const { error } = await sb.from("sips_cache").update({ attempts, next_retry_at: next, last_error_at: new Date().toISOString() }).eq("cups", base);
  if (error && !isMissingColumn(error)) console.warn("[sips]", error.message);
  return row;
}

/**
 * Actualitza un CUPS des del portal. Si la dada és vigent (TTL) i no es força, no consulta el portal.
 * El CUPS pot tenir 20 o 22 caràcters; la clau de la memòria cau és la base de 20.
 */
export async function refreshSips(cupsRaw: string, opts: { force?: boolean } = {}): Promise<SipsSummary & { raw?: Record<string, unknown> | null }> {
  const full = String(cupsRaw ?? "").toUpperCase().replace(/[\s.\-]/g, "");
  const base = cupsBase(full);
  if (!isValidCups(base)) throw new HttpError(400, "CUPS no vàlid: calen 20 o 22 caràcters (ES + 16 xifres + 2 lletres [+2]), de llum o de gas.");
  const e = sipsEnv();
  const sb = adminClient();
  const r0 = await sb.from("sips_cache").select("*").eq("cups", base).maybeSingle();
  if (r0.error && isMissingTable(r0.error)) throw new HttpError(503, "Falta la taula sips_cache: executa supabase/migrations/004_sips_cache_enriquida.sql.");
  if (r0.error) throw r0.error;
  const old = (r0.data ?? null) as (SipsCacheRow & { attempts?: number }) | null;
  if (old && !opts.force && isFresh(old.consulted_at, old.status, e.ttlDays, e.errorRetryHours)) return old;
  if (!e.user || !e.pass) throw new HttpError(503, "Falten SIPS_USER o SIPS_PASSWORD al servidor.");
  try {
    // Sense filtre de tipus: el CUPS pot ser de llum o de gas.
    const { entities } = await sipsQuery({ cups: full.length === 22 ? full : base, energia: "totes", take: 20 }, sipsConfig());
    const rows = entitiesToRows(entities);
    if (rows.length < 2) {
      const row = emptyRow(base, "not_found", "El portal SIPS no retorna cap punt de llum ni de gas amb aquest CUPS.", new Date().toISOString(), { source: "sips", sourceDetail: "Portal SIPS · EAS Renovae" });
      await upsertRow(row);
      return row;
    }
    // Si hi ha més d'un CUPS amb la mateixa base (sufixos diferents), es tria el de més consum.
    const ea = rows[0].indexOf("E.A. Anual (kWh)");
    const best = rows.slice(1).sort((a, b) => Number(b[ea] ?? 0) - Number(a[ea] ?? 0))[0];
    const row = cacheRowFromRecord(base, recordFromRow(rows[0], best), { source: "sips", sourceDetail: "Portal SIPS · EAS Renovae" });
    await upsertRow(row);
    const { error } = await sb.from("sips_cache").update({ attempts: 0, next_retry_at: null, last_success_at: row.consulted_at }).eq("cups", base);
    if (error && !isMissingColumn(error)) console.warn("[sips]", error.message);
    return row;
  } catch (err) {
    if (err instanceof SipsError && err.status === 400) throw new HttpError(400, err.message);
    const message = err instanceof Error ? err.message : "Error de consulta";
    return recordError(base, old, message);
  }
}

/** Cerca al portal (CUPS o codi postal + adreça). Retorna les 97 columnes per al mateix importador. */
export async function searchSips(q: SearchInput) {
  const cfg = sipsConfig();
  const { total, entities } = await sipsQuery(q, cfg);
  let rows;
  try { rows = entitiesToRows(entities); } catch { throw new SipsError(502, "No s'han pogut interpretar les dades retornades pel portal SIPS.", "transformacio"); }
  return { total, rows, annualConsumptions: consumptionFromEntities(entities), consultedAt: new Date().toISOString(), source: "Portal SIPS · EAS Renovae" };
}

/** Error de l'API amb codi tipificat (perquè la interfície distingeixi cada cas). Mai inclou credencials. */
export function sipsErrorResponse(e: unknown) {
  if (e instanceof SipsError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  if (e instanceof HttpError) {
    const code = e.status === 401 ? "sessio" : e.status === 403 ? "sense_permisos" : e.status === 429 ? "limit" : e.status === 400 ? "cups_invalid" : e.status === 503 ? "no_configurat" : "consulta";
    return Response.json({ error: e.message, code }, { status: e.status });
  }
  console.error("[sips]", e instanceof Error ? e.message.slice(0, 200) : "error");
  return Response.json({ error: "Error intern consultant SIPS.", code: "consulta" }, { status: 500 });
}

/** Desa resultats de cerca per CUPS (un sol subministrament) a la memòria cau. */
export async function cacheSearchRows(rows: (string | number | boolean | null)[][]) {
  for (const r of rows.slice(1, 6)) {
    const base = cupsBase(r[1]);
    if (!isValidCups(base)) continue;
    await upsertRow(cacheRowFromRecord(base, recordFromRow(rows[0], r), { source: "sips", sourceDetail: "Portal SIPS · EAS Renovae (cerca)" }));
  }
}

/** Importació d'un Excel SIPS a Supabase. No substitueix dades del portal més recents. */
export async function importExcelRows(rows: (string | number | boolean | null)[][], file: string) {
  const header = rows[0] ?? [];
  const idx = header.findIndex((h) => String(h ?? "").trim().toUpperCase() === "CUPS");
  if (idx < 0) throw new HttpError(400, "El fitxer no té la columna CUPS.");
  const now = new Date().toISOString();
  const candidates = new Map<string, SipsCacheRow>();
  for (const r of rows.slice(1)) {
    const base = cupsBase(r[idx]);
    if (!isValidCups(base)) continue;
    candidates.set(base, cacheRowFromRecord(base, recordFromRow(header, r), { source: "excel", sourceDetail: `Excel SIPS · ${file}`, consultedAt: now }));
  }
  const existing = new Map((await readCache([...candidates.keys()])).map((x) => [x.cups, x]));
  let saved = 0, skipped = 0;
  for (const [k, row] of candidates) {
    const old = existing.get(k);
    if (old && old.status === "found" && old.source !== "excel" && isFresh(old.consulted_at, old.status, sipsEnv().ttlDays, 24)) {
      skipped++;
      continue;
    }
    await upsertRow(row);
    saved++;
  }
  return { saved, skipped, invalid: rows.length - 1 - candidates.size };
}

/* ------------------------------------------------------------- enriquiment automàtic */

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>, deadline: number) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && Date.now() < deadline) await fn(items[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/**
 * Enriqueix els contractes de llum pendents o contactats amb CUPS vàlid.
 * Prioritza els CUPS sense dades i després els més antics. Respecta TTL, reintents, límit i temps.
 */
export async function enrichPending(limit = sipsEnv().cronLimit, budgetMs = 40_000) {
  const deadline = Date.now() + budgetMs;
  const e = sipsEnv();
  const sb = adminClient();
  const { data: states, error: se } = await sb.from("crm_state").select("contract_id,status").limit(20000);
  if (se) throw se;
  const st = new Map((states ?? []).map((x) => [x.contract_id, x.status as string]));
  const candidates = new Set<string>();
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { data, error } = await sb.from("contracts").select("id,cups,data,removed_from_source").range(offset, offset + 999);
    if (error) throw error;
    for (const c of data ?? []) {
      if (c.removed_from_source) continue;
      const d = c.data as { status?: string; tipo?: string };
      const status = st.get(c.id) ?? d?.status;
      if (status !== "pendiente" && status !== "contactado") continue;
      if (d?.tipo !== "luz" && d?.tipo !== "gas" && d?.tipo !== "dual") continue;
      const key = normalizedCups(c.cups);
      if (isValidCups(key)) candidates.add(key.slice(0, 20));
    }
    if ((data ?? []).length < 1000) break;
  }
  const keys = [...candidates];
  const cached = new Map<string, { consulted_at: string; status: string; next_retry_at?: string | null }>();
  for (let i = 0; i < keys.length; i += 200) {
    let r = await sb.from("sips_cache").select("cups,consulted_at,status,next_retry_at").in("cups", keys.slice(i, i + 200));
    if (r.error && isMissingColumn(r.error)) r = (await sb.from("sips_cache").select("cups,consulted_at,status").in("cups", keys.slice(i, i + 200))) as typeof r;
    if (r.error) throw r.error;
    for (const x of r.data ?? []) cached.set(x.cups, x);
  }
  const now = Date.now();
  const due = keys
    .filter((k) => {
      const c = cached.get(k);
      if (!c) return true;
      if (c.next_retry_at && new Date(c.next_retry_at).getTime() > now) return false;
      return !isFresh(c.consulted_at, c.status, e.ttlDays, e.errorRetryHours, now);
    })
    .sort((a, b) => (cached.get(a) ? new Date(cached.get(a)!.consulted_at).getTime() : 0) - (cached.get(b) ? new Date(cached.get(b)!.consulted_at).getTime() : 0))
    .slice(0, limit);
  let updated = 0, failed = 0;
  await pool(
    due,
    e.concurrency,
    async (k) => {
      try {
        const r = await refreshSips(k, { force: true });
        if (r.status === "error" || r.error) failed++;
        else updated++;
      } catch {
        failed++;
      }
    },
    deadline,
  );
  const result = { candidates: keys.length, due: due.length, updated, failed, pending: Math.max(0, due.length - updated - failed) };
  await audit(null, "enrich", { limit }, updated, failed === 0, failed ? `${failed} errors` : undefined);
  return result;
}
