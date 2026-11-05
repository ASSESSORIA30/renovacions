import "server-only";
/**
 * EXPORTACIONS A EXCEL (servidor). Llegeix amb la sessió de l'usuari (la RLS limita les files) i comprova el permís
 * del mòdul de cada conjunt. Els filtres només poden fer servir columnes de la definició (src/core/exports.ts).
 * Cada exportació queda registrada a l'auditoria (conjunt, nombre de files i filtres, sense dades personals).
 */
import ExcelJS from "exceljs";
import { EXPORTS, cleanQuery, exportDef, type ExportCol, type ExportDef, type ExportQuery } from "@/core/exports";
import { HttpError } from "./supabase";
import type { U } from "./crm";
import { finStaff, hasPerm, secLog } from "./permissions";

const STAFF = ["admin", "cap_administrativa", "administrativa"];
const MAX_ROWS = 50_000;
const MISSING = /does not exist|schema cache|Could not find/i;

async function allowed(u: U, def: ExportDef) {
  if (def.adminOnly && u.profile.role !== "admin") return false;
  if (def.staffOnly && !STAFF.includes(u.profile.role)) return false;
  if (def.module === "economia") return finStaff(u);
  return hasPerm(u, def.module, "read");
}
async function need(u: U, id: string) {
  const def = exportDef(id);
  if (!def) throw new HttpError(400, "Conjunt de dades desconegut");
  if (!(await allowed(u, def))) throw new HttpError(403, `No tens permís per exportar «${def.label}»`);
  return def;
}

/** Conjunts que l'usuari pot exportar. */
export async function exportCatalog(u: U) {
  const out = [];
  for (const d of EXPORTS) if (await allowed(u, d)) out.push({ id: d.id, label: d.label, group: d.group, statusCol: d.statusCol ?? null, statusLabel: d.statusLabel ?? "Estat", dates: d.dates, retailer: !!d.retailerCol, owner: !!d.ownerCol, collaborator: !!d.collaboratorCol, facets: d.facets ?? [], columns: d.columns.map((c) => ({ key: c.key, header: c.header })), archivable: ["crm_clients", "crm_supplies"].includes(d.table), expandJson: !!d.expandJson });
  return { sets: out };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(q: any, def: ExportDef, f: ExportQuery, me?: string) {
  for (const [k, v] of Object.entries(def.base ?? {})) q = q.eq(k, v);
  if (def.statusCol && f.status?.length) q = q.in(def.statusCol, f.status);
  if (f.dateCol && f.from) q = q.gte(f.dateCol, f.from);
  if (f.dateCol && f.to) q = q.lte(f.dateCol, /_at$/.test(f.dateCol) ? `${f.to}T23:59:59.999Z` : f.to);
  if (f.q && def.search.length) q = q.or(def.search.map((c) => `${c}.ilike.%${f.q}%`).join(","));
  if (f.retailer && def.retailerCol) q = q.ilike(def.retailerCol, `%${f.retailer}%`);
  if (f.owner && def.ownerCol) q = q.eq(def.ownerCol, f.owner);
  if (f.ownerNull && def.ownerCol) q = q.is(def.ownerCol, null);
  if (f.ownerMe && def.ownerCol && me) q = q.eq(def.ownerCol, me);
  if (f.ids?.length) q = q.in(def.idCol ?? "id", f.ids);
  for (const [k, v] of Object.entries(f.links ?? {})) q = q.eq(k, v);
  for (const c of f.extras ?? []) {
    const [op, col] = c;
    if (op === "eq") q = q.eq(col, c[2]); else if (op === "neq") q = q.neq(col, c[2]); else if (op === "gt") q = q.gt(col, c[2]); else if (op === "lt") q = q.lt(col, c[2]);
    else if (op === "ilike") q = q.ilike(col, String(c[2]));
    else if (op === "in") q = q.in(col, c[2]); else if (op === "not_in") q = q.not(col, "in", `(${(c[2] as string[]).join(",")})`);
    else if (op === "is_null") q = q.is(col, null); else if (op === "not_null") q = q.not(col, "is", null);
    else if (op === "lt_now") q = q.lt(col, new Date().toISOString());
  }
  if (f.collaborator && def.collaboratorCol) q = q.eq(def.collaboratorCol, f.collaborator);
  for (const [k, v] of Object.entries(f.facets ?? {})) q = q.eq(k, v);
  if (["crm_clients", "crm_supplies"].includes(def.table) && !f.archived) q = q.is("archived_at", null);
  return q;
}

/** Valors existents dels camps filtrables (estat i camps concrets), dins del que l'usuari pot veure. */
export async function exportMeta(u: U, id: string) {
  const def = await need(u, id);
  const cols = [def.statusCol, ...(def.facets ?? []).map((f) => f.col)].filter(Boolean) as string[];
  const values: Record<string, string[]> = {};
  for (const c of cols) {
    let q = u.sb.from(def.table).select(c).not(c, "is", null).limit(5000);
    for (const [k, v] of Object.entries(def.base ?? {})) q = q.eq(k, v);
    const r = await q;
    if (r.error) { if (MISSING.test(r.error.message)) throw new HttpError(503, "Aquest conjunt necessita una migració que encara no s'ha aplicat"); continue; }
    values[c] = [...new Set(((r.data ?? []) as unknown as Record<string, unknown>[]).map((x) => String(x[c])))].sort((a, b) => a.localeCompare(b, "ca")).slice(0, 200);
  }
  return { values };
}

export async function exportCount(u: U, id: string, raw: Record<string, string>) {
  const def = await need(u, id);
  const f = cleanQuery(def, raw);
  const r = await applyFilters(u.sb.from(def.table).select("*", { count: "exact", head: true }), def, f, u.user.id);
  if (r.error) throw new HttpError(MISSING.test(r.error.message) ? 503 : 400, MISSING.test(r.error.message) ? "Aquest conjunt necessita una migració que encara no s'ha aplicat" : "No s'ha pogut comptar");
  return { count: r.count ?? 0, max: MAX_ROWS };
}

/* ----------------------------------------------------------------------- noms llegibles per als identificadors */

async function resolvers(u: U, rows: Record<string, unknown>[], cols: ExportCol[]) {
  const ids = (t: ExportCol["type"]) => [...new Set(cols.filter((c) => c.type === t).flatMap((c) => rows.map((r) => r[c.key])).filter((x): x is string => typeof x === "string" && x.length > 0))];
  const fetchMap = async (table: string, select: string, list: string[], fmt: (x: Record<string, unknown>) => string) => {
    const m = new Map<string, string>();
    for (let i = 0; i < list.length; i += 300) {
      const r = await u.sb.from(table).select(select).in("id", list.slice(i, i + 300));
      for (const x of ((r.data ?? []) as unknown as Record<string, unknown>[])) m.set(String(x.id), fmt(x));
    }
    return m;
  };
  const people = await fetchMap("profiles", "id,name", ids("person"), (x) => String(x.name ?? ""));
  const clientIds = ids("client");
  const contracts = await fetchMap("crm_contracts", "id,client_id,retailer,product", ids("contract"), (x) => JSON.stringify(x));
  for (const v of contracts.values()) { const c = JSON.parse(v) as { client_id: string }; if (c.client_id && !clientIds.includes(c.client_id)) clientIds.push(c.client_id); }
  const clients = await fetchMap("crm_clients", "id,name", clientIds, (x) => String(x.name ?? ""));
  const supplies = await fetchMap("crm_supplies", "id,cups", ids("supply"), (x) => String(x.cups ?? ""));
  const statements = await fetchMap("fin_provider_statements", "id,retailer,reference", ids("statement"), (x) => `${x.retailer} · ${x.reference}`);
  const invoices = await fetchMap("bill_invoices", "id,invoice_no", ids("invoice"), (x) => String(x.invoice_no ?? "esborrany"));
  const prodRaw = await fetchMap("tariff_products", "id,name,access_tariff,energy_type,supplier_id", ids("product"), (x) => JSON.stringify(x));
  const supIds = [...new Set([...prodRaw.values()].map((v) => (JSON.parse(v) as { supplier_id: string }).supplier_id))];
  const sups = new Map<string, string>();
  if (supIds.length) { const r = await u.sb.from("tariff_suppliers").select("id,name").in("id", supIds); for (const x of r.data ?? []) sups.set(x.id as string, x.name as string); }
  const products = new Map([...prodRaw.entries()].map(([k, v]) => { const p = JSON.parse(v) as { name: string; access_tariff: string; energy_type: string; supplier_id: string }; return [k, `${sups.get(p.supplier_id) ?? ""} · ${p.name} · ${p.access_tariff} · ${p.energy_type === "gas" ? "gas" : "llum"}`]; }));
  return (t: ExportCol["type"], v: unknown): string | null => {
    if (typeof v !== "string" || !v) return null;
    if (t === "person") return people.get(v) ?? null;
    if (t === "client") return clients.get(v) ?? null;
    if (t === "supply") return supplies.get(v) ?? null;
    if (t === "statement") return statements.get(v) ?? null;
    if (t === "invoice") return invoices.get(v) ?? null;
    if (t === "product") return products.get(v) ?? null;
    if (t === "contract") { const c = contracts.get(v); if (!c) return null; const k = JSON.parse(c) as { client_id: string; retailer: string; product: string | null }; return [clients.get(k.client_id), k.retailer, k.product].filter(Boolean).join(" · "); }
    return null;
  };
}

const flat = (v: unknown): string | number | boolean | null => {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? JSON.stringify(x) : String(x ?? ""))).join("; ");
  if (typeof v === "object") return JSON.stringify(v);
  return v as string | number | boolean;
};

export async function exportXlsx(u: U, id: string, raw: Record<string, string>) {
  const def = await need(u, id);
  const f = cleanQuery(def, raw);
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS; from += 1000) {
    const r = await applyFilters(u.sb.from(def.table).select("*"), def, f, u.user.id).order(def.order.col, { ascending: !!def.order.asc, nullsFirst: false }).range(from, from + 999);
    if (r.error) throw new HttpError(MISSING.test(r.error.message) ? 503 : 400, MISSING.test(r.error.message) ? "Aquest conjunt necessita una migració que encara no s'ha aplicat" : "No s'han pogut llegir les dades");
    rows.push(...((r.data ?? []) as Record<string, unknown>[]));
    if ((r.data ?? []).length < 1000) break;
  }
  const cols = f.columns ? def.columns.filter((c) => f.columns!.includes(c.key)) : def.columns;
  const name = await resolvers(u, rows, cols);
  // claus de les dades JSON (renovacions, tarifes): una columna per clau
  const jsonKeys = def.expandJson && (!f.columns || f.columns.includes(def.expandJson)) ? [...new Set(rows.flatMap((r) => Object.keys((r[def.expandJson!] ?? {}) as Record<string, unknown>)))].slice(0, 80) : [];

  const wb = new ExcelJS.Workbook();
  wb.creator = "Assessoria 3.0 CRM"; wb.created = new Date();
  const ws = wb.addWorksheet(def.label.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [...cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? (["date", "datetime", "money", "num", "bool"].includes(c.type ?? "") ? 14 : 18) })), ...jsonKeys.map((k) => ({ header: k, key: `json:${k}`, width: 16 }))];
  for (const r of rows) {
    const line: Record<string, unknown> = {};
    for (const c of cols) {
      const v = r[c.key];
      switch (c.type) {
        case "date": line[c.key] = v ? new Date(`${String(v).slice(0, 10)}T12:00:00Z`) : null; break;
        case "datetime": line[c.key] = v ? new Date(String(v)) : null; break;
        case "money": case "num": case "pct": line[c.key] = v == null || v === "" ? null : Number(v); break;
        case "bool": line[c.key] = v == null || v === false || v === "" ? "No" : "Sí"; break;
        case "list": line[c.key] = flat(v); break;
        case "person": case "client": case "supply": case "statement": case "invoice": case "product": case "contract": line[c.key] = name(c.type, v); break;
        default: line[c.key] = flat(v);
      }
    }
    for (const k of jsonKeys) line[`json:${k}`] = flat(((r[def.expandJson!] ?? {}) as Record<string, unknown>)[k]);
    ws.addRow(line);
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF15803D" } };
  head.alignment = { vertical: "middle" };
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === "money") col.numFmt = '#,##0.00 "€"';
    else if (c.type === "date") col.numFmt = "dd/mm/yyyy";
    else if (c.type === "datetime") col.numFmt = "dd/mm/yyyy hh:mm";
    else if (c.type === "num") col.numFmt = "#,##0.##";
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, cols.length + jsonKeys.length) } };
  // full amb els filtres aplicats (traçabilitat)
  const info = wb.addWorksheet("Filtres");
  info.columns = [{ header: "Camp", key: "k", width: 26 }, { header: "Valor", key: "v", width: 60 }];
  const facetLabel = (c: string) => def.facets?.find((x) => x.col === c)?.label ?? c;
  [["Conjunt", def.label], ["Exportat per", u.profile.name], ["Data", new Date().toLocaleString("ca-ES", { timeZone: "Europe/Madrid" })], ["Files", String(rows.length)],
    ...(f.status?.length ? [[def.statusLabel ?? "Estat", f.status.join(", ")]] : []),
    ...(f.from || f.to ? [[def.dates.find((d) => d.col === f.dateCol)?.label ?? "Data", `${f.from ?? "…"} → ${f.to ?? "…"}`]] : []),
    ...(f.q ? [["Cerca", f.q]] : []), ...(f.retailer ? [["Comercialitzadora", f.retailer]] : []),
    ...(f.owner ? [["Responsable", name("person", f.owner) ?? f.owner]] : []), ...(f.collaborator ? [["Col·laborador / beneficiari", name("person", f.collaborator) ?? f.collaborator]] : []),
    ...Object.entries(f.facets ?? {}).map(([k, v]) => [facetLabel(k), v]), ...(f.archived ? [["Inclou arxivats", "Sí"]] : []),
    ...(rows.length >= MAX_ROWS ? [["Avís", `S'han exportat les primeres ${MAX_ROWS} files. Afina els filtres per obtenir la resta.`]] : []),
  ].forEach(([k, v]) => info.addRow({ k, v }));
  info.getRow(1).font = { bold: true };
  await secLog(u, "exportacio_excel", def.table, def.id, { files: rows.length, filtres: Object.keys(raw).filter((k) => !["r", "entity"].includes(k) && raw[k]) });
  const stamp = new Date().toISOString().slice(0, 10);
  return { bytes: new Uint8Array(await wb.xlsx.writeBuffer()), fileName: `${def.id}_${stamp}.xlsx`, rows: rows.length };
}
