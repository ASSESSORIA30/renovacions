import "server-only";
/**
 * Fase 8.1 · avisos automàtics (mateix motor i mateixa idempotència que la resta: rule_key únic per usuari).
 *  - comercialitzadora_venciment: contractes de col·laboració vigents que vencen dins del termini d'avís → Direcció.
 *  - comercialitzadora_infrapagament: línies de liquidació de la comercialitzadora per sota del pactat → Direcció.
 *  - equip_tasques_vencudes: tasques vençudes dels comercials d'un equip → el seu Cap d'equip.
 *  - equip_sense_activitat: comercial sense activitat registrada en X dies laborables → el seu Cap d'equip.
 * Si les migracions 016/017 no s'han aplicat, no fa res (no trenca el motor).
 */
import { workdaysBetween } from "@/core/teams";
import { underpayments } from "@/core/retailers";
import type { adminClient } from "./supabase";

type SB = ReturnType<typeof adminClient>;
type Rule = { key: string; enabled: boolean; params: Record<string, unknown> };
type Note = { user_id: string; kind: string; title: string; body: string | null; link: { view: string; params: Record<string, string> }; rule_key: string };

export async function fase81Automations(sb: SB, now: Date, rules: Rule[]): Promise<Note[]> {
  const on = (k: string) => rules.find((r) => r.key === k && r.enabled);
  const out: Note[] = [];
  const today = now.toISOString().slice(0, 10);
  const admins = ((await sb.from("profiles").select("id").eq("role", "admin")).data ?? []).map((p) => p.id as string);

  if (on("comercialitzadora_venciment")) {
    const d = await sb.from("retailer_documents").select("id,retailer_id,title,valid_to,renewal_notice_days,retailers(trade_name)").eq("status", "vigent").not("valid_to", "is", null);
    if (!d.error) for (const x of d.data ?? []) {
      const left = (new Date(`${x.valid_to}T12:00:00Z`).getTime() - now.getTime()) / 86_400_000;
      if (x.valid_to! < today || left > (x.renewal_notice_days ?? 60)) continue;
      const name = (Array.isArray(x.retailers) ? x.retailers[0] : x.retailers)?.trade_name ?? "";
      for (const a of admins) out.push({ user_id: a, kind: "economia", title: `Venç el contracte amb ${name}`, body: `«${x.title}» venç el ${x.valid_to} (${Math.ceil(left)} dies).`, link: { view: "comercialitzadora", params: { id: x.retailer_id } }, rule_key: `ret_venc:${x.id}:${x.valid_to}` });
    }
  }
  const infra = on("comercialitzadora_infrapagament");
  if (infra) {
    const min = Number(infra.params?.min_eur ?? 5);
    const l = await sb.from("fin_statement_lines").select("id,amount,expected_amount,kind,fin_provider_statements(retailer,reference)").not("expected_amount", "is", null).limit(5000);
    if (!l.error) {
      const rows = (l.data ?? []) as { id: string; amount: string; expected_amount: string; kind: string; fin_provider_statements: { retailer: string; reference: string } | { retailer: string; reference: string }[] | null }[];
      for (const u of underpayments(rows, min)) {
        const st = rows.find((r) => r.id === u.id)?.fin_provider_statements;
        const s = Array.isArray(st) ? st[0] : st;
        for (const a of admins) out.push({ user_id: a, kind: "economia", title: `${s?.retailer ?? "Comercialitzadora"} ha pagat menys del pactat`, body: `Liquidació ${s?.reference ?? ""}: pagat ${u.paid.toFixed(2)} € de ${u.expected.toFixed(2)} € (−${u.gap.toFixed(2)} €).`, link: { view: "conciliacio", params: {} }, rule_key: `ret_infra:${u.id}` });
      }
    }
  }

  const tasks = on("equip_tasques_vencudes"), idle = on("equip_sense_activitat");
  if (tasks || idle) {
    const t = await sb.from("crm_teams").select("id,lead_id,crm_team_members(user_id,left_at)").eq("active", true).not("lead_id", "is", null);
    if (!t.error) for (const team of (t.data ?? []) as { id: string; lead_id: string; crm_team_members: { user_id: string; left_at: string | null }[] }[]) {
      const ids = team.crm_team_members.filter((m) => !m.left_at).map((m) => m.user_id);
      if (!ids.length) continue;
      const names = new Map(((await sb.from("profiles").select("id,name").in("id", ids)).data ?? []).map((p) => [p.id as string, p.name as string]));
      if (tasks) {
        const ov = await sb.from("crm_tasks").select("id,title,assigned_to,due_at").in("assigned_to", ids).in("status", ["pendent", "en_curs", "bloquejada"]).lt("due_at", now.toISOString()).limit(500);
        for (const x of ov.data ?? []) out.push({ user_id: team.lead_id, kind: "tasca", title: `Tasca vençuda a l'equip: ${x.title}`, body: `${names.get(x.assigned_to as string) ?? "—"} · venç el ${String(x.due_at).slice(0, 10)}`, link: { view: "tasques", params: { id: x.id as string } }, rule_key: `equip_tasca:${x.id}` });
      }
      if (idle) {
        const days = Number(idle.params?.days ?? 5);
        const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
        const acts = await sb.from("crm_activities").select("user_id,created_at").in("user_id", ids).gte("created_at", since).order("created_at", { ascending: false }).limit(5000);
        const last = new Map<string, string>();
        for (const a of acts.data ?? []) if (!last.has(a.user_id as string)) last.set(a.user_id as string, a.created_at as string);
        for (const id of ids) {
          const l = last.get(id);
          if (l && workdaysBetween(l, now) < days) continue;
          out.push({ user_id: team.lead_id, kind: "equip", title: `${names.get(id) ?? "Un comercial"} sense activitat`, body: l ? `Última activitat registrada el ${l.slice(0, 10)}.` : "Cap activitat registrada en els últims 60 dies.", link: { view: "panell-equip", params: {} }, rule_key: `equip_inactiu:${id}:${today}` });
        }
      }
    }
  }
  return out;
}
