import "server-only";
import { createHash } from "node:crypto";
import { importContracts, pickSheets, type ImportReport } from "@/core/importer";
import type { SourceContract } from "@/core/types";
import { env } from "./env";
import { latestInFolder, readDriveSpreadsheet, writeBackStatuses } from "./google";
import { adminClient } from "./supabase";

const hash = (c: SourceContract) => createHash("sha1").update(JSON.stringify(c)).digest("hex");
const LABEL: Record<string, string> = { pendiente: "PENDIENTE", contactado: "CONTACTADO", renovado: "RENOVADO", no_renueva: "NO RENUEVA" };

/** Match the exported CRM owner email to an existing collaborator profile.
 * No partners/accounts are created; ambiguous emails remain unlinked.
 * The original email in SourceContract.colaborador is always preserved.
 */
export function linkOwnerEmail(c: SourceContract, matches: Map<string, { id: string; name: string }[]>): SourceContract {
  const email = c.colaborador?.trim().toLowerCase() || null;
  if (!email) return { ...c, colaboradorPartnerId: null, colaboradorPartnerName: null, colaboradorLinkStatus: "intern" };
  const options = matches.get(email) ?? [];
  if (options.length !== 1) return {
    ...c, colaborador: email, colaboradorPartnerId: null, colaboradorPartnerName: null,
    colaboradorLinkStatus: options.length ? "ambigu" : "pendent",
  };
  return { ...c, colaborador: email, colaboradorPartnerId: options[0].id, colaboradorPartnerName: options[0].name, colaboradorLinkStatus: "vinculat" };
}

async function collaboratorEmailIndex(sb: ReturnType<typeof adminClient>) {
  type Partner = { id: string; name: string; email: string | null; user_id: string | null };
  type Profile = { id: string; email: string | null; role: string };
  const partners: Partner[] = [];
  const profiles: Profile[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("cap_partners").select("id,name,email,user_id").range(from, from + 999);
    if (error) throw error;
    partners.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("profiles").select("id,email,role").range(from, from + 999);
    if (error) throw error;
    profiles.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const profileById = new Map(profiles.filter((x) => x.role === "colaborador").map((x) => [x.id, x]));
  const index = new Map<string, { id: string; name: string }[]>();
  for (const p of partners) {
    const emails = new Set([p.email, p.user_id ? profileById.get(p.user_id)?.email : null]
      .map((x) => x?.trim().toLowerCase()).filter((x): x is string => Boolean(x)));
    for (const email of emails) {
      const group = index.get(email) ?? [];
      if (!group.some((x) => x.id === p.id)) group.push({ id: p.id, name: p.name });
      index.set(email, group);
    }
  }
  return index;
}

/** Upsert source contracts. CRM state lives in other tables and is never touched here. No duplicates: id derives from CUPS. */
export async function upsertSource(contracts: SourceContract[], report: ImportReport, origin: string) {
  const sb = adminClient();
  const existing = new Map<string, string>();
  const ownerMatches = await collaboratorEmailIndex(sb);
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("contracts").select("id, source_hash").range(from, from + 999);
    if (error) throw error;
    data!.forEach((r) => existing.set(r.id, r.source_hash));
    if (data!.length < 1000) break;
  }
  let added = 0, updated = 0, unchanged = 0;
  const rows = [];
  for (const imported of contracts) {
    const c = linkOwnerEmail(imported, ownerMatches);
    const h = hash(c);
    const old = existing.get(c.id);
    if (old === undefined) added++; else if (old !== h) updated++; else { unchanged++; continue; }
    rows.push({ id: c.id, cups: c.cups, comercial: c.comercial, captador: c.captador?.toUpperCase() ?? null, colaborador: c.colaborador?.toLowerCase() ?? null, data: c, source_hash: h, updated_at: new Date().toISOString(), removed_from_source: false });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("contracts").upsert(rows.slice(i, i + 500));
    if (error) throw error;
  }
  // contracts that disappeared from the sheet are flagged, never deleted (keeps history)
  const seen = new Set(contracts.map((c) => c.id));
  // els contractes creats al CRM (id "crm:…") no venen de l'Excel: mai es marquen com a desapareguts
  const gone = [...existing.keys()].filter((id) => !seen.has(id) && !id.startsWith("crm:"));
  for (let i = 0; i < gone.length; i += 500) await sb.from("contracts").update({ removed_from_source: true }).in("id", gone.slice(i, i + 500));
  await sb.from("sync_runs").insert({ origin, report, added, updated, unchanged, ok: true });
  return { added, updated, unchanged };
}

export async function runGoogleSync() {
  const sb = adminClient();
  try {
    // The CRM export gets a new file each time (Contratos_YYYYMMDD_HHMMSS.xlsx): with SOURCE_CRM_FOLDER_ID we always take the newest one.
    let crmId = env.crmFileId;
    if (process.env.SOURCE_CRM_FOLDER_ID) {
      const latest = await latestInFolder(process.env.SOURCE_CRM_FOLDER_ID, process.env.SOURCE_CRM_PREFIX ?? "Contratos_");
      if (latest) crmId = latest.id;
    }
    if (!crmId) throw new Error("No hi ha cap fitxer de contractes configurat (SOURCE_CRM_FILE_ID o SOURCE_CRM_FOLDER_ID)");
    const crmFile = await readDriveSpreadsheet(crmId);
    const diarioFile = env.diarioFileId ? await readDriveSpreadsheet(env.diarioFileId) : null;
    const crm = pickSheets(crmFile.sheets).crm;
    if (!crm) throw new Error(`No s'ha trobat el full de contractes a ${crmFile.name}`);
    const { data: cfg } = await sb.from("app_config").select("value").eq("key", "mapping").maybeSingle();
    const mapping = (cfg?.value ?? {}) as { crm?: Record<string, string>; diario?: Record<string, string> };
    const today = new Date().toISOString().slice(0, 10);
    const { contracts, report } = importContracts({
      today,
      crm: { sheet: crm, mapping: mapping.crm },
      diario: diarioFile ? { sheets: pickSheets(diarioFile.sheets).diario, mapping: mapping.diario } : undefined,
    });
    const origin = `Google Drive · ${crmFile.name}${diarioFile ? ` + ${diarioFile.name}` : ""}`;
    const r = await upsertSource(contracts, report, origin);

    let writeback = 0;
    if (env.writebackSheetId) {
      const { data: states } = await sb.from("crm_state").select("contract_id, status");
      const { data: cups } = await sb.from("contracts").select("id, cups");
      const idToCups = new Map((cups ?? []).map((c) => [c.id, c.cups]));
      const byCups = new Map<string, string>();
      for (const s of states ?? []) { const cu = idToCups.get(s.contract_id); if (cu) byCups.set(cu, LABEL[s.status]); }
      const tab = process.env.WRITEBACK_TAB ?? "Contratos";
      writeback = (await writeBackStatuses(env.writebackSheetId, tab, byCups)).updated;
    }
    return { ...r, report, writeback };
  } catch (e) {
    await sb.from("sync_runs").insert({ origin: "Google Drive", ok: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
