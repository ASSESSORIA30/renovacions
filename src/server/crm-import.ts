import "server-only";
/** Importació inicial de la cartera (contractes de l'Excel ja sincronitzats) cap al CRM. Només Administració/Direcció. */
import { nameKey, planImport, type ImportSource } from "@/core/crm-import";
import type { SourceContract, Status } from "@/core/types";
import { adminClient, HttpError } from "./supabase";
import { auditEvent, isStaffRole, type U } from "./crm";

async function all<T>(table: string, columns: string, filter?: (q: ReturnType<ReturnType<typeof adminClient>["from"]>["select"]) => unknown): Promise<T[]> {
  const sb = adminClient();
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(columns).range(from, from + 999);
    if (filter) q = filter(q as never) as typeof q;
    const { data, error } = await q;
    if (error) throw new HttpError(409, /does not exist|schema cache/i.test(error.message) ? "Falta aplicar la migració 008" : `Error llegint ${table}`);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export async function importPortfolio(u: U, dryRun: boolean) {
  if (!isStaffRole(u.profile.role)) throw new HttpError(403, "Només Administració o Direcció poden importar la cartera");
  const sb = adminClient();
  const [contracts, states, clients, supplies, legacy, profiles] = await Promise.all([
    all<{ id: string; data: SourceContract; removed_from_source: boolean }>("contracts", "id,data,removed_from_source", (q) => (q as unknown as { not: (c: string, o: string, v: string) => unknown }).not("id", "like", "crm:%")),
    all<{ contract_id: string; status: Status }>("crm_state", "contract_id,status"),
    all<{ id: string; tax_id: string | null; name: string; phone: string | null }>("crm_clients", "id,tax_id,name,phone"),
    all<{ cups20: string }>("crm_supplies", "cups20", (q) => (q as unknown as { is: (c: string, v: null) => unknown }).is("archived_at", null)),
    all<{ legacy_contract_id: string | null }>("crm_contracts", "legacy_contract_id"),
    all<{ id: string; code: string | null; email: string; role: string }>("profiles", "id,code,email,role"),
  ]);
  const status = new Map(states.map((s) => [s.contract_id, s.status]));
  const rows: ImportSource[] = contracts.map((c) => ({ contract: c.data, status: status.get(c.id) ?? null, removed: c.removed_from_source }));
  const ownerByCode = new Map(profiles.filter((p) => p.code && p.role === "comercial").map((p) => [p.code!.toUpperCase(), p.id]));
  const collaboratorByKey = new Map<string, string>();
  for (const p of profiles.filter((x) => x.role === "colaborador")) {
    collaboratorByKey.set(p.email.toLowerCase(), p.id);
    if (p.code) collaboratorByKey.set(p.code.toUpperCase().replace(/^COL\.?\s*/, "").trim(), p.id);
  }
  // Partner profiles are stored in cap_partners, sometimes without a login.
  // The crm_clients.collaborator_id FK points to auth.users, so only assign it
  // when there is an actual linked user. Unlinked partners remain visible via
  // the contract-owner email resolver in CRM -> Clients.
  const partnerRows = await all<{ id: string; name: string; email: string | null; user_id: string | null }>("cap_partners", "id,name,email,user_id");
  const partnerEmailUsers = new Map<string, Set<string>>();
  for (const partner of partnerRows) {
    const key = (partner.email ?? "").trim().toLowerCase();
    if (!key || !partner.user_id || !profiles.some(p => p.id === partner.user_id && p.role === "colaborador")) continue;
    const matches = partnerEmailUsers.get(key) ?? new Set<string>();
    matches.add(partner.user_id);
    partnerEmailUsers.set(key, matches);
  }
  for (const [email, users] of partnerEmailUsers) {
    if (users.size === 1 && !collaboratorByKey.has(email)) collaboratorByKey.set(email, [...users][0]);
  }
  const today = new Date().toISOString().slice(0, 10);
  const plan = planImport(rows, {
    taxIds: new Map(clients.filter((c) => c.tax_id).map((c) => [c.tax_id!, c.id])),
    // repetir la importació no duplica els clients sense NIF (es reconeixen per nom i telèfon)
    nameKeys: new Map(clients.filter((c) => !c.tax_id).map((c) => [nameKey(c.name, c.phone), c.id])),
    cups20: new Set(supplies.map((s) => s.cups20)),
    legacyIds: new Set(legacy.map((l) => l.legacy_contract_id).filter((x): x is string => !!x)),
    ownerByCode,
    collaboratorByKey,
  }, today);
  if (dryRun) return { dryRun: true, stats: plan.stats };

  // Repair previously imported clients without changing any existing assignment.
  // Resolve by each already-linked legacy contract; never assign if different
  // collaborators own contracts of the same client.
  const [oldLinks, oldClientOwners] = await Promise.all([
    all<{ client_id: string; legacy_contract_id: string | null }>("crm_contracts", "client_id,legacy_contract_id"),
    all<{ id: string; collaborator_id: string | null }>("crm_clients", "id,collaborator_id"),
  ]);
  const sourceById = new Map(contracts.map(c => [c.id, (c.data.colaborador ?? "").trim().toLowerCase()]));
  const candidates = new Map<string, Set<string>>();
  for (const link of oldLinks) {
    const email = link.legacy_contract_id ? sourceById.get(link.legacy_contract_id) : null;
    if (!email) continue;
    const key = collaboratorByKey.get(email);
    const set = candidates.get(link.client_id) ?? new Set<string>();
    set.add(key ?? "unresolved:" + email);
    candidates.set(link.client_id, set);
  }
  for (const client of oldClientOwners) {
    if (client.collaborator_id) continue;
    const options = candidates.get(client.id);
    if (options?.size !== 1) continue;
    const only = [...options][0];
    if (only.startsWith("unresolved:")) continue;
    const { error } = await sb.from("crm_clients").update({ collaborator_id: only }).eq("id", client.id).is("collaborator_id", null);
    if (error) throw new HttpError(500, `Error vinculant col·laborador al client: ${error.code}`);
  }

  let createdClients = 0, createdSupplies = 0, createdContracts = 0;
  const groups = plan.groups;
  for (let i = 0; i < groups.length; i += 200) {
    const chunk = groups.slice(i, i + 200);
    const fresh = chunk.filter((g) => g.row);
    if (fresh.length) {
      const ins = await sb.from("crm_clients").insert(fresh.map((g) => ({ ...g.row, created_by: u.user.id }))).select("id,tax_id,name");
      if (ins.error) throw new HttpError(500, `Error creant clients: ${ins.error.code}`);
      fresh.forEach((g, k) => { g.existingId = ins.data![k].id; });
      createdClients += ins.data!.length;
    }
    const sup = chunk.flatMap((g) => g.supplies.map((s) => ({ ...s, client_id: g.existingId, created_by: u.user.id })));
    const supplyId = new Map<string, string>();
    if (sup.length) {
      const ins = await sb.from("crm_supplies").insert(sup).select("id,cups20");
      if (ins.error) {
        // algun CUPS creat mentrestant: s'insereixen un a un i s'ometen els duplicats
        for (const s of sup) {
          const one = await sb.from("crm_supplies").insert(s).select("id,cups20");
          if (!one.error && one.data?.[0]) { supplyId.set(one.data[0].cups20, one.data[0].id); createdSupplies++; }
        }
      } else {
        for (const r of ins.data ?? []) supplyId.set(r.cups20, r.id);
        createdSupplies += ins.data?.length ?? 0;
      }
    }
    const ks = chunk.flatMap((g) => g.contracts.map(({ _cups20, ...k }) => ({ ...k, client_id: g.existingId, supply_id: _cups20 ? supplyId.get(_cups20) ?? null : null, created_by: u.user.id })));
    if (ks.length) {
      const ins = await sb.from("crm_contracts").insert(ks).select("id,supply_id,status,retailer");
      if (ins.error) throw new HttpError(500, `Error creant contractes: ${ins.error.code}`);
      createdContracts += ins.data!.length;
      // vincle de cada CUPS amb el seu contracte vigent en una sola consulta (migració 009); si no hi és, un a un
      const sids = [...new Set(ins.data!.filter((k) => k.supply_id && k.status === "actiu").map((k) => k.supply_id as string))];
      if (sids.length) {
        const linked = await sb.rpc("crm_link_current_contracts", { p_supplies: sids });
        if (linked.error) for (const k of ins.data!) if (k.supply_id && k.status === "actiu") await sb.from("crm_supplies").update({ current_contract_id: k.id }).eq("id", k.supply_id);
      }
    }
    const acts = chunk.filter((g) => g.row).map((g) => ({ client_id: g.existingId, type: "canvi", title: "Client importat des de la cartera (Excel)", user_id: u.user.id, user_name: u.profile.name }));
    if (acts.length) await sb.from("crm_activities").insert(acts);
  }
  await auditEvent(u, { entity: "import", entityId: today, action: "importacio-cartera", detail: { clients: createdClients, supplies: createdSupplies, contracts: createdContracts } });
  return { dryRun: false, stats: plan.stats, created: { clients: createdClients, supplies: createdSupplies, contracts: createdContracts } };
}
