/**
 * Parser for the "ZocoProductos V1.4" offers template (Plantilla_comercializadoras.xlsx, sheet "Productos").
 *
 * Layout (row 2 = sub-headers):
 *  A Comercializadora · B Tipo (Electricidad|Gas|Dual|Telefonia|Alarmas|Autoconsumo) · C Tarifa · D Producto
 *  E Gas fijo (€/día) · F Gas variable (€/kWh) · G–L Potencia P1–P6 (€/kW·día) · M–R Energía P1–P6 (€/kWh)
 *  S Residencial · T PYME · U Excedentes · V Tipo de precio · W Ámbito · X/Y Potencia mín/máx · Z/AA Consumo mín/máx
 *  AB–AD Fee potencia (único, mín, máx) · AE–AG Fee energía (único, mín, máx) · AH Mes (indexado) · AI Tarifa gas · AJ Producto gas (dual)
 *
 * Only Electricidad, Gas and Dual rows produce offers (they are the ones that can be compared).
 * The key "comercializadora + tarifa + producto" makes re-imports UPDATE existing offers instead of duplicating them.
 */
import { anyToISO } from "./dates";
import { periodsFor } from "./compare";
import { hashId, norm, type Row } from "./importer";
import type { Offer } from "./types";

export interface OfferImportResult {
  offers: Offer[];
  skipped: { row: number; reason: string; label: string }[];
  warnings: { row: number; message: string }[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, ""));
  return isFinite(n) ? n : null;
};
const str = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() || null);
const yes = (v: unknown) => (v == null || v === "" ? null : /^s[ií]/i.test(String(v).trim()));
const tarifa = (v: unknown) => (str(v) ?? "").replace(/^Tarifa\s+/i, "") || null;

export function offerKey(comercializadora: string, tarifaS: string, nombre: string) {
  return "of-" + hashId([comercializadora, tarifaS, nombre].map(norm).join("|"));
}
/** Two offers are "the same" when supplier + tariff + name match (case/accents ignored). */
export const sameOffer = (a: { comercializadora: string; tarifa: string; nombre: string }, b: { comercializadora: string; tarifa: string; nombre: string }) =>
  norm(a.comercializadora) === norm(b.comercializadora) && norm(a.tarifa).replace(/^tarifa /, "") === norm(b.tarifa).replace(/^tarifa /, "") && norm(a.nombre) === norm(b.nombre);

export function parseOffersTemplate(rows: Row[], opts: { validaHasta: string; verificadaPor: string }): OfferImportResult {
  // locate the sub-header row ("Comercializadora", "Tipo", "Tarifa", "Producto")
  const hi = rows.findIndex((r) => norm(r?.[0]) === "comercializadora" && norm(r?.[1]) === "tipo");
  if (hi < 0) throw new Error("No és la plantilla de comercialitzadores: falta la fila de capçalera «Comercializadora | Tipo | Tarifa | Producto».");
  const out: OfferImportResult = { offers: [], skipped: [], warnings: [] };

  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const g = (c: number) => r[c];
    const comer = str(g(0));
    const tipo = norm(g(1));
    if (!comer && !tipo) continue;
    const rowN = i + 1;
    const producto = str(g(3)) ?? "Sense nom";
    const label = `${comer ?? "?"} · ${producto}`;
    if (!comer) { out.skipped.push({ row: rowN, label, reason: "Falta la comercialitzadora" }); continue; }
    if (!["electricidad", "gas", "dual"].includes(tipo)) {
      out.skipped.push({ row: rowN, label, reason: `Tipus «${str(g(1)) ?? "buit"}»: no s'utilitza a les comparatives d'energia` });
      continue;
    }
    const meta: Offer["meta"] = {
      origen: "plantilla",
      residencial: yes(g(18)),
      pyme: yes(g(19)),
      excedentes: str(g(20)),
      tipoPrecio: str(g(21)),
      ambito: str(g(22)),
      potenciaMin: num(g(23)), potenciaMax: num(g(24)),
      consumoMin: num(g(25)), consumoMax: num(g(26)),
      feePotencia: { unico: str(g(27)), min: num(g(28)), max: num(g(29)) },
      feeEnergia: { unico: str(g(30)), min: num(g(31)), max: num(g(32)) },
      mesIndexado: g(33) instanceof Date ? anyToISO(g(33))?.slice(0, 7) ?? null : str(g(33)),
      dual: tipo === "dual",
    };
    // imported offers are immediately available for proposals
    const base = { validaHasta: opts.validaHasta, verificada: true, verificadaPor: opts.verificadaPor };

    // ---- electricity part (Electricidad or Dual)
    if (tipo === "electricidad" || tipo === "dual") {
      const t = tarifa(g(2));
      if (!t) { out.skipped.push({ row: rowN, label, reason: "Falta la tarifa de llum" }); }
      else {
        const per = periodsFor(t);
        const potencia = [6, 7, 8, 9, 10, 11].map((c) => num(g(c))).slice(0, per.power);
        const energia = [12, 13, 14, 15, 16, 17].map((c) => num(g(c))).slice(0, per.energy);
        const missing = [...energia.map((v, n) => (v == null ? `energia P${n + 1}` : null)), ...potencia.map((v, n) => (v == null ? `potència P${n + 1}` : null))].filter(Boolean);
        if (missing.length) out.skipped.push({ row: rowN, label: `${label} (${t})`, reason: `Falten preus: ${missing.join(", ")}` });
        else {
          const extra = [...[6, 7, 8, 9, 10, 11].slice(per.power), ...[12, 13, 14, 15, 16, 17].slice(per.energy)].some((c) => num(g(c)) != null);
          if (extra) out.warnings.push({ row: rowN, message: `${label}: la tarifa ${t} fa servir ${per.energy} períodes d'energia i ${per.power} de potència; la resta s'ignoren.` });
          out.offers.push({
            id: offerKey(comer, t, tipo === "dual" ? `${producto} (dual)` : producto), comercializadora: comer, nombre: tipo === "dual" ? `${producto} (dual)` : producto,
            tarifa: t, tipo: "luz", energia, potencia, cuotaFijaMes: null, fijoDia: null, ...base, meta,
            notas: meta.tipoPrecio ? `Preu ${meta.tipoPrecio.toLowerCase()}` : null,
          });
        }
      }
    }
    // ---- gas part (Gas or Dual)
    if (tipo === "gas" || tipo === "dual") {
      const t = tipo === "dual" ? tarifa(g(34)) : tarifa(g(2));
      const prod = tipo === "dual" ? str(g(35)) ?? `${producto} gas` : producto;
      const fijo = num(g(4)), variable = num(g(5));
      if (!t) out.skipped.push({ row: rowN, label, reason: tipo === "dual" ? "Dual sense «Tarifa gas»" : "Falta la tarifa de gas" });
      else if (variable == null || fijo == null) out.skipped.push({ row: rowN, label: `${comer} · ${prod} (${t})`, reason: "Falten els preus de gas (fix €/dia i variable €/kWh)" });
      else out.offers.push({
        id: offerKey(comer, t, tipo === "dual" ? `${prod} (dual)` : prod), comercializadora: comer, nombre: tipo === "dual" ? `${prod} (dual)` : prod,
        tarifa: t, tipo: "gas", energia: [variable], potencia: [], cuotaFijaMes: null, fijoDia: fijo, ...base, meta,
        notas: meta.tipoPrecio ? `Preu ${meta.tipoPrecio.toLowerCase()}` : null,
      });
    }
  }
  return out;
}
