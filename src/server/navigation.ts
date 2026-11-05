import "server-only";
/**
 * FASE 9 · NAVEGACIÓ I CONTEXT (servidor). Tot amb la sessió de l'usuari: la RLS decideix què pot veure.
 *  - resolveRenewal: client de Clients 360° d'un contracte de Renovacions (per obrir-ne la fitxa des del nom).
 *  - supplyPoint: punt de subministrament d'un CUPS amb TOTS els contractes i titulars al llarg del temps.
 *  - recents: registres consultats per l'usuari (només els seus).
 *  - esborranys de comparatives: desament automàtic al servidor, amb control de versions (conflictes).
 */
import { z } from "zod";
import { HttpError } from "./supabase";
import { dbError, parse, type U } from "./crm";

const uuid = z.string().uuid();
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache|Could not find/i.test(e.message ?? ""));
const need019 = () => new HttpError(503, "Falta aplicar la migració supabase/migrations/019_navegacio_360.sql a Supabase");
const internal = (u: U) => { if (u.profile.role === "colaborador") throw new HttpError(403, "Només per a l'equip intern"); };

/** CUPS normalitzat per cercar: majúscules, sense separadors; es compara pels 20 primers caràcters (amb o sense «0F»). */
export function normCups(raw: string | null | undefined) {
  const c = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return { full: c, cups20: c.slice(0, 20), valid: /^ES[0-9]{16}[A-Z]{2}/.test(c) };
}

/* ======================================================================= contracte de renovacions → client 360 */

export async function resolveRenewal(u: U, renewalId: string, cupsRaw?: string | null) {
  internal(u);
  const id = renewalId.trim();
  if (!id || id.length > 200) throw new HttpError(400, "Contracte no vàlid");
  let contract: { id: string; client_id: string } | null = null;
  if (id.startsWith("crm:")) {
    const k = id.slice(4);
    if (!uuid.safeParse(k).success) throw new HttpError(400, "Contracte no vàlid");
    const r = await u.sb.from("crm_contracts").select("id,client_id").eq("id", k).maybeSingle();
    if (r.error) dbError(r.error);
    contract = r.data;
  } else {
    const r = await u.sb.from("crm_contracts").select("id,client_id").eq("legacy_contract_id", id).order("created_at", { ascending: false }).limit(1);
    if (r.error) dbError(r.error);
    contract = r.data?.[0] ?? null;
  }
  let clientId = contract?.client_id ?? null, supplyId: string | null = null, via: "contracte" | "cups" | null = contract ? "contracte" : null;
  const c = normCups(cupsRaw);
  if (c.valid) {
    const s = await u.sb.from("crm_supplies").select("id,client_id").eq("cups20", c.cups20).is("archived_at", null).limit(1);
    if (!s.error && s.data?.[0]) { supplyId = s.data[0].id; if (!clientId) { clientId = s.data[0].client_id; via = "cups"; } }
  }
  if (!clientId) return { linked: false as const };
  const cl = await u.sb.from("crm_clients").select("id,name").eq("id", clientId).maybeSingle();
  if (!cl.data) return { linked: false as const };
  return { linked: true as const, clientId: cl.data.id as string, clientName: cl.data.name as string, contractId: contract?.id ?? null, supplyId, via };
}

/* ======================================================================= punt de subministrament (CUPS) */

export async function supplyPoint(u: U, cupsRaw: string) {
  internal(u);
  const c = normCups(cupsRaw);
  if (!c.valid) throw new HttpError(400, "CUPS no vàlid");
  const s = await u.sb.from("crm_supplies").select("id,client_id,cups,energy_type,address,postal_code,city,province,holder_name,current_retailer,access_tariff,power_kw,annual_kwh,status,archived_at,data_source,data_updated_at,crm_clients(id,name,kind,tax_id)").eq("cups20", c.cups20).limit(20);
  if (s.error) dbError(s.error, "No s'ha pogut consultar el punt de subministrament");
  type Cl = { id: string; name: string; kind: string; tax_id: string | null };
  const supplies = (s.data ?? []) as unknown as { id: string; client_id: string; cups: string; energy_type: string; address: string | null; postal_code: string | null; city: string | null; province: string | null; holder_name: string | null; current_retailer: string | null; access_tariff: string | null; power_kw: (number | null)[] | null; annual_kwh: number | null; status: string; archived_at: string | null; data_source: string; data_updated_at: string; crm_clients: Cl | Cl[] | null }[];
  const one = <T,>(x: T | T[] | null) => (Array.isArray(x) ? x[0] : x) ?? null;
  const ids = supplies.map((x) => x.id);
  const k = ids.length ? await u.sb.from("crm_contracts").select("id,client_id,supply_id,retailer,product,access_tariff,signed_at,start_date,end_date,status,legacy_contract_id,crm_clients(id,name)").in("supply_id", ids).order("start_date", { ascending: false, nullsFirst: false }) : { data: [], error: null };
  if (k.error) dbError(k.error);
  const contracts = ((k.data ?? []) as unknown as { id: string; client_id: string; supply_id: string; retailer: string; product: string | null; access_tariff: string | null; signed_at: string | null; start_date: string | null; end_date: string | null; status: string; legacy_contract_id: string | null; crm_clients: { id: string; name: string } | { id: string; name: string }[] | null }[])
    .map(({ crm_clients, ...x }) => ({ ...x, client_name: one(crm_clients)?.name ?? null }));
  // titulars al llarg del temps (un CUPS pot haver tingut diversos clients)
  const holders = new Map<string, { clientId: string; name: string; from: string | null; to: string | null; current: boolean; contracts: number }>();
  for (const x of contracts) {
    const h = holders.get(x.client_id) ?? { clientId: x.client_id, name: x.client_name ?? "—", from: null, to: null, current: false, contracts: 0 };
    const from = x.start_date ?? x.signed_at;
    h.from = !h.from || (from && from < h.from) ? from : h.from;
    h.to = !h.to || (x.end_date && x.end_date > h.to) ? x.end_date : h.to;
    h.current = h.current || ["actiu", "renovacio_pendent", "en_tramitacio"].includes(x.status);
    h.contracts++;
    holders.set(x.client_id, h);
  }
  for (const sp of supplies) {
    const cl = one(sp.crm_clients);
    if (cl && !holders.has(cl.id)) holders.set(cl.id, { clientId: cl.id, name: cl.name, from: null, to: null, current: !sp.archived_at, contracts: 0 });
  }
  return {
    cups: c.full, cups20: c.cups20,
    supplies: supplies.map(({ crm_clients, ...x }) => ({ ...x, client: one(crm_clients) ? { id: one(crm_clients)!.id, name: one(crm_clients)!.name, kind: one(crm_clients)!.kind } : null })),
    contracts, holders: [...holders.values()].sort((a, b) => Number(b.current) - Number(a.current) || String(b.from ?? "").localeCompare(String(a.from ?? ""))),
  };
}

/* ======================================================================= registres recents */

const recentQ = z.object({ kind: z.enum(["client", "contracte", "subministrament"]), ref: z.string().trim().min(1).max(200), label: z.string().trim().min(1).max(200), sub: z.string().trim().max(200).nullable().optional() });
export async function recentList(u: U) {
  internal(u);
  const r = await u.sb.from("user_recent_records").select("kind,ref_id,label,sub,visited_at").eq("user_id", u.user.id).order("visited_at", { ascending: false }).limit(20);
  if (r.error) { if (missing(r.error)) return { items: [], migrated: false }; dbError(r.error); }
  return { items: r.data ?? [], migrated: true };
}
export async function recentTouch(u: U, raw: unknown) {
  internal(u);
  const b = parse(recentQ, raw);
  const r = await u.sb.from("user_recent_records").upsert({ user_id: u.user.id, kind: b.kind, ref_id: b.ref, label: b.label, sub: b.sub ?? null, visited_at: new Date().toISOString() }, { onConflict: "user_id,kind,ref_id" });
  if (r.error && !missing(r.error)) dbError(r.error);
  // es conserven els 50 més recents
  const all = await u.sb.from("user_recent_records").select("kind,ref_id,visited_at").eq("user_id", u.user.id).order("visited_at", { ascending: false });
  const old = (all.data ?? []).slice(50);
  for (const o of old) await u.sb.from("user_recent_records").delete().eq("user_id", u.user.id).eq("kind", o.kind).eq("ref_id", o.ref_id);
  return { ok: true };
}
export async function recentClear(u: U) {
  internal(u);
  const r = await u.sb.from("user_recent_records").delete().eq("user_id", u.user.id);
  if (r.error && !missing(r.error)) dbError(r.error);
  return { ok: true };
}

/* ======================================================================= esborranys de comparatives */

const MAX_STATE = 600_000;
const ctxQ = z.object({ contract: z.string().trim().max(200).optional(), client: uuid.optional(), supply: uuid.optional(), cups: z.string().trim().max(30).optional() });
/** Clau de context: un sol esborrany obert per persona i contracte / client+subministrament / CUPS. */
export function contextKey(c: z.infer<typeof ctxQ>): string | null {
  if (c.contract) return `contract:${c.contract}`;
  if (c.client) return `client:${c.client}${c.supply ? `:supply:${c.supply}` : ""}`;
  const k = normCups(c.cups);
  if (k.valid) return `cups:${k.cups20}`;
  return null;
}
const draftCols = "id,context_key,contract_id,crm_client_id,crm_supply_id,cups,client_name,step,state,version,status,comparison_id,created_by,created_by_name,updated_by_name,created_at,updated_at";

/** L'esborrany obert de l'usuari per a aquest context (o un d'id concret). */
export async function draftGet(u: U, raw: Record<string, string>) {
  internal(u);
  if (raw.id) {
    const r = await u.sb.from("comparison_drafts").select(draftCols).eq("id", uuid.parse(raw.id)).maybeSingle();
    if (r.error) { if (missing(r.error)) throw need019(); dbError(r.error); }
    if (!r.data) throw new HttpError(404, "Esborrany no trobat o sense permís");
    return { draft: r.data };
  }
  const key = contextKey(parse(ctxQ, raw));
  if (!key) return { draft: null };
  const r = await u.sb.from("comparison_drafts").select(draftCols).eq("created_by", u.user.id).eq("context_key", key).eq("status", "obert").maybeSingle();
  if (r.error) { if (missing(r.error)) return { draft: null, migrated: false }; dbError(r.error); }
  return { draft: r.data ?? null };
}

const saveQ = ctxQ.extend({
  id: uuid.optional(), version: z.number().int().min(1).optional(), step: z.number().int().min(1).max(5), client_name: z.string().trim().max(200).nullable().optional(),
  state: z.record(z.unknown()),
});
/**
 * Desa l'esborrany. Amb `id` + `version`: només s'actualitza si ningú no l'ha modificat mentrestant; si no,
 * es retorna 409 amb qui l'ha canviat (no es trepitgen els canvis d'una altra persona).
 */
export async function draftSave(u: U, raw: unknown) {
  internal(u);
  const b = parse(saveQ, raw);
  const size = JSON.stringify(b.state).length;
  if (size > MAX_STATE) throw new HttpError(413, "L'esborrany és massa gran per desar-lo");
  const key = contextKey(b);
  const row = { contract_id: b.contract ?? null, crm_client_id: b.client ?? null, crm_supply_id: b.supply ?? null, cups: normCups(b.cups).valid ? normCups(b.cups).full : null, client_name: b.client_name ?? null, step: b.step, state: b.state, updated_by: u.user.id, updated_by_name: u.profile.name };
  if (b.id) {
    if (!b.version) throw new HttpError(400, "Falta la versió de l'esborrany");
    const r = await u.sb.from("comparison_drafts").update(row).eq("id", b.id).eq("version", b.version).eq("status", "obert").select("id,version,updated_at");
    if (r.error) { if (missing(r.error)) throw need019(); dbError(r.error, "No s'ha pogut desar l'esborrany"); }
    if (r.data?.length) return { id: r.data[0].id as string, version: r.data[0].version as number, savedAt: r.data[0].updated_at as string };
    const cur = (await u.sb.from("comparison_drafts").select("version,status,updated_by_name,updated_at").eq("id", b.id).maybeSingle()).data;
    if (!cur) throw new HttpError(404, "L'esborrany ja no existeix o no hi tens accés");
    if (cur.status !== "obert") throw new HttpError(409, "Aquest esborrany ja s'ha tancat (s'ha desat com a comparativa o s'ha descartat)");
    return { conflict: "version" as const, message: `${cur.updated_by_name ?? "Una altra persona"} ha modificat aquest esborrany (${new Date(cur.updated_at).toLocaleString("ca-ES", { timeZone: "Europe/Madrid" })}). Recarrega'l abans de continuar per no perdre cap canvi.`, version: cur.version as number };
  }
  if (!key) throw new HttpError(400, "Cal un contracte, un client o un CUPS per desar l'esborrany");
  const ins = await u.sb.from("comparison_drafts").insert({ ...row, context_key: key, created_by: u.user.id, created_by_name: u.profile.name }).select("id,version,updated_at").single();
  if (ins.error) {
    if (missing(ins.error)) throw need019();
    if (ins.error.code === "23505") {
      // ja n'hi havia un d'obert per a aquest context: es retorna perquè el client el reprengui (no es duplica)
      const ex = (await u.sb.from("comparison_drafts").select(draftCols).eq("created_by", u.user.id).eq("context_key", key).eq("status", "obert").maybeSingle()).data;
      return { conflict: "existing" as const, message: "Ja tenies un esborrany obert per a aquesta comparativa.", draft: ex };
    }
    dbError(ins.error, "No s'ha pogut desar l'esborrany");
  }
  return { id: ins.data.id as string, version: ins.data.version as number, savedAt: ins.data.updated_at as string };
}

export async function draftClose(u: U, raw: unknown) {
  internal(u);
  const b = parse(z.object({ id: uuid, status: z.enum(["finalitzat", "descartat"]), comparisonId: uuid.nullable().optional() }), raw);
  const r = await u.sb.from("comparison_drafts").update({ status: b.status, comparison_id: b.comparisonId ?? null, updated_by: u.user.id, updated_by_name: u.profile.name }).eq("id", b.id).eq("status", "obert").select("id");
  if (r.error) { if (missing(r.error)) throw need019(); dbError(r.error); }
  return { ok: !!r.data?.length };
}

/** Esborranys oberts d'un client (per a la fitxa 360º). */
export async function draftsForClient(u: U, clientId: string) {
  internal(u);
  const r = await u.sb.from("comparison_drafts").select("id,context_key,contract_id,crm_supply_id,cups,client_name,step,status,created_by_name,updated_by_name,updated_at").eq("crm_client_id", uuid.parse(clientId)).eq("status", "obert").order("updated_at", { ascending: false }).limit(50);
  if (r.error) { if (missing(r.error)) return { drafts: [] }; dbError(r.error); }
  return { drafts: r.data ?? [] };
}
