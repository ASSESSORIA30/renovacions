/**
 * Importació inicial de la cartera existent (taula `contracts`, que ve de l'Excel) cap al CRM: agrupa per client
 * (NIF/CIF; si no n'hi ha, nom + telèfon), crea un subministrament per CUPS i un contracte per registre, enllaçat
 * amb el contracte de renovacions (`legacy_contract_id`). Lògica pura i idempotent: el que ja existeix s'omet.
 */
import type { SourceContract, Status } from "./types";
import { checkTaxId, normalizeEmail, normalizePhone, normalizeCupsFull, validCupsFull, provinceFromPostalCode } from "./crm";

export interface ImportSource { contract: SourceContract; status: Status | null; removed: boolean }
export interface ImportExisting { taxIds: Map<string, string>; /** clients sense NIF ja creats: clau «nom|telèfon» (vegeu nameKey) */ nameKeys?: Map<string, string>; cups20: Set<string>; legacyIds: Set<string>; ownerByCode: Map<string, string>; collaboratorByKey: Map<string, string> }

export interface PlannedClient {
  key: string;
  existingId: string | null;
  row: Record<string, unknown> | null;
  supplies: Record<string, unknown>[];
  contracts: (Record<string, unknown> & { _cups20: string | null })[];
}

export const nameKey = (name: string, phone: string | null) => `${strip(name)}|${phone ?? ""}`;
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const COMPANY = /\b(s\.?l\.?u?|s\.?a\.?|s\.?c\.?p?|s\.?coop|c\.?b\.?|sociedad|societat|associaci[oó]|ajuntament|ayuntamiento|fundaci[oó]|comunitat|comunidad)\b/i;

export function planImport(rows: ImportSource[], ex: ImportExisting, today: string) {
  const groups = new Map<string, PlannedClient>();
  const stats = { contracts: 0, skippedContracts: 0, newClients: 0, existingClients: 0, supplies: 0, skippedSupplies: 0, withoutTaxId: 0, invalidTaxId: 0, noCups: 0 };
  const seenCups = new Set(ex.cups20);
  for (const { contract: c, status, removed } of rows) {
    if (c.source === "demo") continue;
    if (ex.legacyIds.has(c.id)) { stats.skippedContracts++; continue; }
    const tax = checkTaxId(c.cif);
    if (!c.cif) stats.withoutTaxId++;
    else if (!tax.valid) stats.invalidTaxId++;
    const phone = normalizePhone(c.telefono);
    const key = tax.valid && tax.value ? `t:${tax.value}` : `n:${nameKey(c.cliente, phone.valid ? phone.value : null)}`;
    let g = groups.get(key);
    if (!g) {
      const existingId = tax.valid && tax.value ? ex.taxIds.get(tax.value) ?? null : ex.nameKeys?.get(key.slice(2)) ?? null;
      const email = normalizeEmail(c.email);
      const owner = ex.ownerByCode.get((c.comercial ?? "").toUpperCase()) ?? null;
      const collab = ex.collaboratorByKey.get((c.colaborador ?? "").toLowerCase()) ?? ex.collaboratorByKey.get((c.captador ?? "").toUpperCase().replace(/^COL\.?\s*/, "").trim()) ?? null;
      const kind = tax.type === "cif" || COMPANY.test(c.cliente) ? "empresa" : "particular";
      const cp = c.cp && /^[0-9]{5}$/.test(c.cp) ? c.cp : null;
      g = {
        key,
        existingId,
        row: existingId ? null : {
          kind, name: c.cliente.trim().slice(0, 200), trade_name: null, tax_id: tax.valid ? tax.value : null, tax_id_type: tax.valid ? tax.type : null,
          status: "inactiu", contact_name: c.representante ?? null, phone: phone.valid ? phone.value : null, email: email.valid ? email.value : null,
          address: c.direccion, postal_code: cp, city: c.poblacion, province: c.provincia ?? provinceFromPostalCode(cp),
          notes: [tax.valid ? null : c.cif ? `Identificador original (no vàlid): ${c.cif}` : null, phone.valid ? null : c.telefono ? `Telèfon original: ${c.telefono}` : null].filter(Boolean).join("\n") || null,
          owner_id: owner, collaborator_id: collab, origin: "Cartera existent", tags: ["importat"], priority: "mitjana",
        },
        supplies: [],
        contracts: [],
      };
      groups.set(key, g);
      if (existingId) stats.existingClients++; else stats.newClients++;
    }
    let cups20: string | null = null;
    if ((c.tipo === "luz" || c.tipo === "gas" || c.tipo === "dual") && validCupsFull(c.cups)) {
      const cups = normalizeCupsFull(c.cups);
      cups20 = cups.slice(0, 20);
      if (!seenCups.has(cups20)) {
        seenCups.add(cups20);
        g.supplies.push({
          cups, energy_type: c.tipo === "gas" ? "gas" : "luz", address: c.direccion, postal_code: c.cp && /^[0-9]{5}$/.test(c.cp) ? c.cp : null, city: c.poblacion, province: c.provincia,
          holder_name: c.cliente, current_retailer: c.comercializadora, access_tariff: c.tarifa, power_kw: c.potencias?.length ? c.potencias.slice(0, 6) : c.potencia != null ? [c.potencia] : null,
          annual_kwh: c.consumoAnual, status: c.fechaBaja || removed ? "baixa" : "actiu", data_source: "importacio",
        });
        stats.supplies++;
      } else stats.skippedSupplies++;
    } else stats.noCups++;
    const expired = !!c.vencimiento && c.vencimiento < today;
    const ended = !!c.fechaBaja || (expired && status !== "renovado");
    const kStatus = removed || ended ? "finalitzat" : "actiu";
    g.contracts.push({
      _cups20: cups20, retailer: c.comercializadora || "Desconeguda", product: c.producto, access_tariff: c.tarifa, start_date: c.fechaInicio, end_date: c.vencimiento && (!c.fechaInicio || c.vencimiento >= c.fechaInicio) ? c.vencimiento : null,
      status: kStatus === "actiu" && !c.vencimiento ? "en_tramitacio" : kStatus, owner_id: ex.ownerByCode.get((c.comercial ?? "").toUpperCase()) ?? null, legacy_contract_id: c.id,
      notes: [c.observaciones, c.tipo === "telefonia" ? "Servei de telefonia" : null].filter(Boolean).join("\n") || null,
    });
    if (kStatus === "actiu" && g.row) g.row.status = "actiu";
    stats.contracts++;
  }
  return { groups: [...groups.values()], stats };
}
