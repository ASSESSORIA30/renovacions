import "server-only";
/**
 * CONNECTORS DE TARIFES PER API (només APIs oficials o accessos autoritzats per contracte).
 *
 * Cap comercialitzadora està connectada per defecte: no totes ofereixen API i no es fa scraping.
 * Per activar-ne una, s'afegeix a TARIFF_CONNECTORS (JSON, només servidor):
 *   [{"providerId":"comercialitzadora-x","name":"Comercialitzadora X","url":"https://api…/offers",
 *     "tokenEnv":"TARIFF_TOKEN_X","format":"normalized"}]
 * El format "normalized" espera una llista d'objectes amb els camps d'OfferVersion (o de l'esquema d'importació).
 * Altres formats requereixen un adaptador propi que implementi TariffProvider.
 */
import { checkVersion, priceChanged, productKey } from "@/comparator/catalog";
import { emptySheet, offerVersionSchema, type OfferVersion } from "@/comparator/types";
import { adminClient } from "./supabase";
import { saveVersion } from "./tariffs";

export type RawOffer = Record<string, unknown>;
export interface ValidationResult { ok: boolean; errors: string[]; warnings: string[] }

export interface TariffProvider {
  providerId: string;
  name: string;
  fetchOffers(): Promise<RawOffer[]>;
  normalizeOffer(raw: RawOffer): OfferVersion;
  validateOffer(offer: OfferVersion): ValidationResult;
}

interface ConnectorConfig { providerId: string; name: string; url: string; tokenEnv?: string; format?: "normalized" }

export function configuredConnectors(): ConnectorConfig[] {
  try {
    const list = JSON.parse(process.env.TARIFF_CONNECTORS || "[]") as ConnectorConfig[];
    return Array.isArray(list) ? list.filter((c) => c.providerId && /^https:\/\//.test(c.url)) : [];
  } catch {
    console.error("[connectors] TARIFF_CONNECTORS no és un JSON vàlid");
    return [];
  }
}

/** Proveïdor genèric per a feeds JSON autoritzats que ja segueixen el model normalitzat. */
export function jsonFeedProvider(c: ConnectorConfig, f: typeof fetch = fetch): TariffProvider {
  return {
    providerId: c.providerId,
    name: c.name,
    async fetchOffers() {
      const token = c.tokenEnv ? process.env[c.tokenEnv] : undefined;
      const r = await f(c.url, { headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const list = Array.isArray(j) ? j : Array.isArray(j?.offers) ? j.offers : null;
      if (!list) throw new Error("Resposta sense llista d'ofertes");
      return list as RawOffer[];
    },
    normalizeOffer(raw) {
      return {
        ...emptySheet(),
        segments: ["residencial", "pyme"],
        permanenceMonths: null, penalty: null, durationMonths: null, priceGuaranteeMonths: null,
        eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null },
        validFrom: null, validTo: null, publishedAt: null, conditions: null,
        ...(raw as Partial<OfferVersion>),
        id: crypto.randomUUID(),
        supplierId: `sup:${c.providerId}`,
        supplierName: String(raw.supplierName ?? c.name),
        productId: "",
        version: 1,
        status: "esborrany",
        origin: "api",
        source: `API ${c.name}`,
      } as OfferVersion;
    },
    validateOffer(o) {
      const z = offerVersionSchema.safeParse(o);
      if (!z.success) return { ok: false, errors: z.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), warnings: [] };
      return checkVersion(o);
    },
  };
}

/**
 * Sincronitza un proveïdor: reintents limitats, versions noves només si canvien els preus,
 * detecció de tarifes retirades (passen a «caducada») i registre de cada execució.
 * Les ofertes noves o modificades entren com a ESBORRANY: un administrador les revisa i activa.
 */
export async function syncProvider(p: TariffProvider, opts: { maxAttempts?: number } = {}) {
  const sb = adminClient();
  const max = Math.min(3, Math.max(1, opts.maxAttempts ?? 3));
  const { data: run } = await sb.from("tariff_connector_runs").insert({ provider_id: p.providerId }).select("id").single();
  let raws: RawOffer[] = [];
  let lastError = "";
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      raws = await p.fetchOffers();
      lastError = "";
      break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt < max) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  if (lastError) {
    await sb.from("tariff_connector_runs").update({ finished_at: new Date().toISOString(), ok: false, error: lastError.slice(0, 500), attempt: max }).eq("id", run?.id);
    console.error(`[connectors] ${p.providerId}: error d'integració`, lastError.slice(0, 200)); // alerta als registres de Vercel
    return { providerId: p.providerId, ok: false, error: lastError };
  }
  const { data: current } = await sb.from("tariff_versions").select("id,product_id,status,data").eq("origin", "api").in("status", ["activa", "esborrany"]);
  const byKey = new Map((current ?? []).filter((r) => (r.data as OfferVersion).supplierId === `sup:${p.providerId}`).map((r) => [productKey(r.data as OfferVersion), r]));
  let created = 0, changed = 0, rejected = 0;
  const seen = new Set<string>();
  for (const raw of raws.slice(0, 500)) {
    const o = p.normalizeOffer(raw);
    const v = p.validateOffer(o);
    if (!v.ok) { rejected++; continue; }
    const key = productKey(o);
    seen.add(key);
    const prev = byKey.get(key);
    if (prev && !priceChanged(prev.data as OfferVersion, o)) continue;
    await saveVersion(null as never, o, { origin: "api", connectorRunId: run?.id ?? null });
    if (prev) changed++; else created++;
  }
  let retired = 0;
  for (const [key, r] of byKey) {
    if (!seen.has(key) && r.status === "activa") {
      await sb.from("tariff_versions").update({ status: "caducada" }).eq("id", r.id);
      retired++;
    }
  }
  await sb.from("tariff_connector_runs").update({ finished_at: new Date().toISOString(), ok: true, fetched: raws.length, created, changed, retired, rejected }).eq("id", run?.id);
  return { providerId: p.providerId, ok: true, fetched: raws.length, created, changed, retired, rejected };
}

export async function syncAllConnectors() {
  const out = [];
  for (const c of configuredConnectors()) out.push(await syncProvider(jsonFeedProvider(c)));
  return out;
}
