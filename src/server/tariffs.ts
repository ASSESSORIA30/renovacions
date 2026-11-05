import "server-only";
import { annexDateOf } from "@/comparator/nufri-mapping";
/**
 * CATÀLEG DE TARIFES (servidor). Escriptura només per a l'equip d'administració (RLS + comprovació aquí).
 * Cada canvi de preus crea una versió nova; les versions usades en propostes emeses són immutables (trigger SQL).
 */
import { blockedRetailer, retailerIndex } from "./retailers";
import { LEGACY_LABEL, checkVersion, classifyLegacy, latestPerProduct, legacyToVersion, productKey, slug } from "@/comparator/catalog";
import { z } from "zod";
import { CONTRACT_TYPES, DEFAULT_PERMANENCE_RULE, offerVersionSchema, type OfferVersion, type PermanenceRule, type TariffStatus } from "@/comparator/types";
import { permanenceIssues } from "@/comparator/permanence";
import type { Offer as CrmOffer } from "@/core/types";
import { adminClient, HttpError, type requireUser } from "./supabase";

type U = Awaited<ReturnType<typeof requireUser>>;
const missingTable = (e: { message?: string } | null) => !!e && /does not exist|schema cache|not find/i.test(e.message ?? "");

type Row = { id: string; product_id: string; version: number; status: TariffStatus; origin: string; data: OfferVersion; used_at: string | null; created_at: string; created_by_name: string | null };

/**
 * Catàleg visible. ÚNICA FONT de tarifes per a comparatives, PDF i renovacions: només `tariff_versions`.
 * Les ofertes de l'antiga taula `offers` («Propostes») ja no es barregen: es revisen i s'incorporen amb `legacyReport`.
 * Sense `allVersions`, una sola versió per producte (la més recent activa): cap tarifa surt duplicada.
 */
export async function listCatalog(u: U, opts: { allVersions?: boolean } = {}) {
  const { data, error } = await u.sb.from("tariff_versions").select("id,product_id,version,status,origin,data,used_at,created_at,created_by_name").order("created_at", { ascending: false }).limit(5000);
  const migrated = !missingTable(error);
  if (error && migrated) throw error;
  const rows = (data ?? []) as Row[];
  const all = rows.map((r) => ({ ...r.data, id: r.id, productId: r.product_id, version: r.version, status: r.status, usedAt: r.used_at, createdAt: r.created_at, createdByName: r.created_by_name }));
  const versions = opts.allVersions ? all : latestPerProduct(all);
  // Fase 10: les ofertes de comercialitzadores desactivades o arxivades no surten per a comparatives noves.
  // Al catàleg complet (allVersions) es mostren, marcades, perquè es conservi l'historial de tarifes.
  const idx = await retailerIndex();
  const off = (o: { supplierName?: string | null }) => !!blockedRetailer(o.supplierName ?? null, idx);
  if (opts.allVersions) return { versions: versions.map((v) => (off(v) ? { ...v, retailerInactive: true } : v)), crm: [] as OfferVersion[], migrated };
  return { versions: versions.filter((v) => !off(v)), crm: [] as OfferVersion[], migrated, hiddenInactive: versions.filter(off).length };
}

/** Versions concretes del catàleg (lectura amb la sessió de l'usuari), amb l'identificador i la versió reals. */
export async function catalogVersionsByIds(u: U, ids: string[]): Promise<Map<string, OfferVersion>> {
  const uuids = [...new Set(ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  const out = new Map<string, OfferVersion>();
  if (!uuids.length) return out;
  const { data, error } = await u.sb.from("tariff_versions").select("id,product_id,version,status,data").in("id", uuids);
  if (error && !missingTable(error)) throw error;
  for (const r of (data ?? []) as Row[]) out.set(r.id, { ...r.data, id: r.id, productId: r.product_id, version: r.version, status: r.status });
  return out;
}

/* ------------------------------------------------------------ migració de l'antic apartat «Propostes» */

/** Informe: què hi ha a `offers`, comparat amb el catàleg i amb les comparatives històriques. No modifica res. */
export async function legacyReport(u: U) {
  const [off, cat, cmp] = await Promise.all([
    u.sb.from("offers").select("data"),
    listCatalog(u, { allVersions: true }),
    u.sb.from("comparisons").select("snapshot").limit(5000),
  ]);
  const offers = ((off.data ?? []) as { data: CrmOffer }[]).map((o) => o.data);
  const usedIn: Record<string, number> = {};
  for (const c of (cmp.data ?? []) as { snapshot: { offers?: { id: string }[] } | null }[]) for (const o of c.snapshot?.offers ?? []) if (o.id.startsWith("crm:")) usedIn[o.id.slice(4)] = (usedIn[o.id.slice(4)] ?? 0) + 1;
  const rows = classifyLegacy(offers, cat.versions, usedIn);
  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.cls] = (a[r.cls] ?? 0) + 1), a), {});
  return { rows, counts, total: rows.length, usedInHistory: rows.filter((r) => r.usedInHistory > 0).length, migrated: cat.migrated };
}

/**
 * Incorpora al catàleg les ofertes antigues que continuen sent vàlides i que encara no hi són. Mai sobreescriu una
 * tarifa existent ni activa ofertes incompletes o caducades (es tornen a classificar al servidor abans de desar).
 */
export async function importLegacy(u: U, ids: string[]) {
  const rep = await legacyReport(u);
  const ok = new Set(rep.rows.filter((r) => r.importable).map((r) => r.id));
  const { data } = await u.sb.from("offers").select("data");
  const byId = new Map(((data ?? []) as { data: CrmOffer }[]).map((o) => [o.data.id, o.data]));
  const done: { id: string; versionId: string }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of [...new Set(ids)]) {
    const o = byId.get(id);
    if (!o) { skipped.push({ id, reason: "No existeix" }); continue; }
    if (!ok.has(id)) { skipped.push({ id, reason: LEGACY_LABEL[rep.rows.find((r) => r.id === id)?.cls ?? "incompleta"] }); continue; }
    const r = await saveVersion(u, legacyToVersion(o), { origin: "manual" });
    done.push({ id, versionId: r.id });
    ok.delete(id); // dues ofertes iguals a la mateixa petició: només la primera
  }
  return { imported: done, skipped };
}

async function ensureProduct(o: OfferVersion) {
  const sb = adminClient();
  const supplierId = `sup:${slug(o.supplierName)}`;
  const s = await sb.from("tariff_suppliers").upsert({ id: supplierId, name: o.supplierName, logo: o.supplierLogo ?? null }, { onConflict: "id", ignoreDuplicates: false });
  if (s.error) throw s.error;
  const key = productKey(o);
  const found = await sb.from("tariff_products").select("id").eq("product_key", key).maybeSingle();
  if (found.error) throw found.error;
  if (found.data) return { supplierId, productId: found.data.id as string };
  const ins = await sb.from("tariff_products").insert({ supplier_id: supplierId, name: o.productName, energy_type: o.energyType, access_tariff: o.accessTariff, product_key: key }).select("id").single();
  if (ins.error) throw ins.error;
  return { supplierId, productId: ins.data.id as string };
}

async function nextVersion(productId: string) {
  const { data } = await adminClient().from("tariff_versions").select("version").eq("product_id", productId).order("version", { ascending: false }).limit(1);
  return ((data?.[0]?.version as number | undefined) ?? 0) + 1;
}

/** Desa una versió. Si `id` és d'un esborrany existent i no s'ha usat, l'actualitza; si no, en crea una de nova. */
export async function saveVersion(u: U, input: unknown, opts: { origin?: "manual" | "excel" | "api"; importRunId?: string | null; connectorRunId?: number | null } = {}) {
  const parsed = offerVersionSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, `Tarifa no vàlida: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const o = parsed.data as OfferVersion;
  const sb = adminClient();
  const { supplierId, productId } = await ensureProduct(o);
  const existing = o.id && /^[0-9a-f-]{36}$/.test(o.id) ? await sb.from("tariff_versions").select("id,status,used_at,product_id").eq("id", o.id).maybeSingle() : { data: null };
  const origin = opts.origin ?? (o.origin === "crm" ? "manual" : o.origin);
  // una tarifa incompleta o amb la permanència obligatòria pendent no s'activa: queda en esborrany
  const rule = await permanenceRule(sb);
  const status: TariffStatus = o.status === "activa" && (!checkVersion(o).ok || permanenceIssues(o, rule).length > 0) ? "esborrany" : o.status;
  // l'excepció a la regla de permanència només la pot documentar Direcció
  if (o.permanence?.exception && u?.profile.role !== "admin") {
    const prev = existing.data ? (await sb.from("tariff_versions").select("data").eq("id", o.id).maybeSingle()).data?.data as OfferVersion | undefined : undefined;
    const prevByProduct = !prev ? ((await sb.from("tariff_versions").select("data").eq("product_id", productId).order("version", { ascending: false }).limit(1)).data?.[0]?.data as OfferVersion | undefined) : undefined;
    if ((prev ?? prevByProduct)?.permanence?.exception !== o.permanence.exception) throw new HttpError(403, "Només Direcció pot documentar una excepció a la permanència obligatòria");
  }
  // un annex més antic no substitueix mai un de més recent del mateix producte (matriu comercial, p. ex. Nufri)
  const incoming = annexDateOf(o);
  if (incoming) {
    const latest = (await sb.from("tariff_versions").select("data").eq("product_id", productId).order("version", { ascending: false }).limit(1)).data?.[0]?.data as OfferVersion | undefined;
    const current = latest ? annexDateOf(latest) : null;
    if (current && incoming < current) throw new HttpError(409, `${o.productName}: l'annex del document (${incoming}) és més antic que el del catàleg (${current}). No es pot substituir.`);
  }
  if (existing.data && existing.data.status === "esborrany" && !existing.data.used_at && existing.data.product_id === productId) {
    const data = { ...o, supplierId, productId, status };
    const r = await sb.from("tariff_versions").update({ data, status, valid_from: o.validFrom, valid_to: o.validTo, source: o.source }).eq("id", o.id).select("id").single();
    if (r.error) throw r.error;
    return { id: r.data.id as string, version: o.version, status };
  }
  const version = await nextVersion(productId);
  const data = { ...o, supplierId, productId, version, status, origin };
  const r = await sb
    .from("tariff_versions")
    .insert({ product_id: productId, version, status, origin, data, valid_from: o.validFrom, valid_to: o.validTo, source: o.source, import_run_id: opts.importRunId ?? null, connector_run_id: opts.connectorRunId ?? null, created_by: u?.user.id ?? null, created_by_name: u?.profile.name ?? "Sistema" })
    .select("id")
    .single();
  if (r.error) throw r.error;
  await sb.from("tariff_versions").update({ data: { ...data, id: r.data.id } }).eq("id", r.data.id);
  return { id: r.data.id as string, version, status };
}

/* ------------------------------------------------------------ regla de permanència obligatòria (Direcció) */

/** Regla vigent (sec_settings «permanencia», només Direcció la modifica). Per defecte: fixes 3.0TD i 6.1TD. */
export async function permanenceRule(sb: { from: SupabaseLike["from"] } = adminClient()): Promise<PermanenceRule> {
  try {
    const { data } = await sb.from("sec_settings").select("value").eq("key", "permanencia").maybeSingle();
    const v = (data as { value?: Partial<PermanenceRule> } | null)?.value;
    return v ? { ...DEFAULT_PERMANENCE_RULE, ...v } : DEFAULT_PERMANENCE_RULE;
  } catch { return DEFAULT_PERMANENCE_RULE; }
}
type SupabaseLike = ReturnType<typeof adminClient>;

export async function savePermanenceRule(u: U, raw: unknown) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció pot canviar la regla de permanència");
  const r = z.object({ enabled: z.boolean(), tariffs: z.array(z.string().max(10)).max(10), contractTypes: z.array(z.enum(CONTRACT_TYPES)).max(4) }).parse(raw);
  const { error } = await u.sb.from("sec_settings").upsert({ key: "permanencia", value: r }, { onConflict: "key" });
  if (error) throw new HttpError(400, error.message);
  return r;
}

/** Canvia l'estat. Només s'activa si la versió és completa; activar-ne una arxiva les altres actives del producte. */
export async function setStatus(id: string, status: TariffStatus) {
  const sb = adminClient();
  const { data, error } = await sb.from("tariff_versions").select("id,product_id,data").eq("id", id).single();
  if (error) throw error;
  if (status === "activa") {
    const c = checkVersion(data.data as OfferVersion);
    if (!c.ok) throw new HttpError(400, `No es pot activar: ${c.errors.join("; ")}`);
    const perm = permanenceIssues(data.data as OfferVersion, await permanenceRule(sb));
    if (perm.length) throw new HttpError(400, `No es pot activar: ${perm.join("; ")}`);
    await sb.from("tariff_versions").update({ status: "arxivada", data: undefined }).eq("product_id", data.product_id).eq("status", "activa").neq("id", id);
  }
  const r = await sb.from("tariff_versions").update({ status, data: { ...(data.data as OfferVersion), status } }).eq("id", id);
  if (r.error) {
    // versions usades: el trigger no deixa canviar `data`; només l'estat
    const r2 = await sb.from("tariff_versions").update({ status }).eq("id", id);
    if (r2.error) throw r2.error;
  }
  return { id, status };
}

/** Marca com a usades (immutables) les versions del catàleg d'una proposta emesa. */
export async function markUsed(versionIds: string[]) {
  const ids = versionIds.filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (!ids.length) return;
  await adminClient().from("tariff_versions").update({ used_at: new Date().toISOString() }).in("id", ids).is("used_at", null);
}

/** Versions actives i vigents (per al cron de caducitat). */
export async function expireOutdated(today = new Date().toISOString().slice(0, 10)) {
  const { data, error } = await adminClient().from("tariff_versions").update({ status: "caducada" }).eq("status", "activa").lt("valid_to", today).select("id");
  if (error && !missingTable(error)) throw error;
  return { expired: data?.length ?? 0 };
}
