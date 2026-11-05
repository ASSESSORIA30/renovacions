import "server-only";
import type { U } from "./crm";

/** Resolve the imported owner's email against partners, without changing CRM assignments.
 * Client membership is derived from its individual legacy contracts: mixed-owner clients
 * appear under each applicable owner. Reads respect the user's CRM contract RLS.
 */
export async function clientOwnerIndex(u: U) {
  const readAll = async <T>(table: string, columns: string): Promise<T[]> => {
    const out: T[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await u.sb.from(table).select(columns).range(start, start + 999);
      if (error) throw error;
      out.push(...(data ?? []) as T[]);
      if ((data ?? []).length < 1000) break;
    }
    return out;
  };
  type Partner = { id: string; name: string; email: string | null; user_id: string | null };
  type Profile = { id: string; name: string; email: string | null; role: string };
  type Legacy = { id: string; data: { colaborador?: string | null } | null };
  type Link = { client_id: string; legacy_contract_id: string | null };
  const [partners, profiles, legacy, links] = await Promise.all([
    readAll<Partner>("cap_partners", "id,name,email,user_id"),
    readAll<Profile>("profiles", "id,name,email,role"),
    readAll<Legacy>("contracts", "id,data"),
    readAll<Link>("crm_contracts", "client_id,legacy_contract_id"),
  ]);
  const profileById = new Map(profiles.map(p => [p.id, p]));
  const byEmail = new Map<string, Partner[]>();
  const email = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  for (const p of partners) {
    for (const e of new Set([email(p.email), email(p.user_id ? profileById.get(p.user_id)?.email : null)])) {
      if (!e) continue;
      const matches = byEmail.get(e) ?? [];
      if (!matches.some(x => x.id === p.id)) matches.push(p);
      byEmail.set(e, matches);
    }
  }
  const profileByEmail = new Map(profiles.filter(p => p.role === "colaborador" && email(p.email)).map(p => [email(p.email), p]));
  const sourceById = new Map(legacy.map(l => [l.id, email(l.data?.colaborador)]));
  const labels = new Map<string, string>();
  const clientKeys = new Map<string, Set<string>>();
  for (const link of links) {
    const raw = link.legacy_contract_id ? sourceById.get(link.legacy_contract_id) : null;
    if (!raw) continue;
    const matches = byEmail.get(raw) ?? [];
    const profile = profileByEmail.get(raw);
    const key = matches.length === 1 ? `partner:${matches[0].id}` : matches.length > 1 ? `ambiguous:${raw}` : profile ? `user:${profile.id}` : raw === "info@assessoria30.com" ? "internal" : `unlinked:${raw}`;
    const label = matches.length === 1 ? matches[0].name : matches.length > 1 ? `${raw} (ambigu)` : profile ? profile.name : raw === "info@assessoria30.com" ? "Assessoria 3.0" : `${raw} (sense vincular)`;
    labels.set(key, label);
    const keys = clientKeys.get(link.client_id) ?? new Set<string>();
    keys.add(key);
    clientKeys.set(link.client_id, keys);
  }
  return { labels, clientKeys };
}
