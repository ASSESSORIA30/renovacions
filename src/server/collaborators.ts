import "server-only";
/**
 * COL·LABORADORS · importació, habilitació per a comissions i percentatges (servidor).
 * Amplia el mòdul existent (cap_partners) i fa servir el motor de comissions existent (fin_rules, capa «collaborador»,
 * tipus «pct_comissio_rebuda»). No hi ha cap càlcul paral·lel.
 *  - Importar i habilitar: només Direcció. Les fitxes es creen amb la clau de servei després de comprovar-ho.
 *  - Percentatges: Direcció els aprova directament; la Cap administrativa els deixa «pendents d'aprovació».
 *  - Habilitar per a comissions crea el compte BLOQUEJAT (sense contrasenya, sense invitació i sense poder entrar).
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { D } from "@/core/commissions";
import { DEFAULT_LEVELS, LEVEL_KEYS, cleanLevels, levelOf, normalizeRows, propose, validPct, type Existing, type ImportRow, type Levels, type Proposal } from "@/core/collaborators";
import { toCsv, validTaxId } from "@/core/billing";
import { personKind } from "@/core/collaborators";
import { issueAccessLink } from "./access-link";
import { adminClient, HttpError } from "./supabase";
import { parse, type U } from "./crm";
import { finStaff, secLog } from "./permissions";

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no vàlida");
const today = () => new Date().toISOString().slice(0, 10);
const BAN = "876000h"; // ~100 anys: el compte existeix per a les comissions però no pot iniciar sessió
const BASE_FORMULA = "Comissió que cobra Assessoria 3.0 de la comercialitzadora pel contracte (capa proveïdor: confirmada a la liquidació o, si encara no, estimada). No és el consum, ni el preu de l'energia, ni l'import de cap factura.";
const MIGRATION = "Falta aplicar la migració supabase/migrations/027_collaboradors_comissions.sql a Supabase";

const admin = (u: U) => { if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció pot fer aquesta acció"); };
async function canManage(u: U) {
  if (u.profile.role === "admin") return true;
  return u.profile.role === "cap_administrativa" && (await finStaff(u, "edit"));
}
const fail = (e: { code?: string; message?: string } | null, fallback = "No s'ha pogut desar"): never => {
  const m = e?.message ?? "";
  if (e?.code === "42703" || e?.code === "42P01" || /column .* does not exist|does not exist|schema cache/i.test(m)) throw new HttpError(503, MIGRATION);
  if (e?.code === "23505") throw new HttpError(409, /tax_id/.test(m) ? "Ja hi ha un col·laborador amb aquest DNI/CIF" : "Registre duplicat");
  if (e?.code === "42501") throw new HttpError(403, m || "Sense permís");
  if (e?.code === "23514") throw new HttpError(400, m || "Dades no vàlides");
  console.error("[collaboradors]", e?.code, m.slice(0, 200));
  throw new HttpError(500, fallback);
};
const ruleKey = (userId: string) => `collab_${userId.replace(/-/g, "").slice(0, 16)}`;

/* ======================================================================= importació */

const importQ = z.object({ fileName: z.string().trim().min(1).max(200), rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000) });

async function existing() {
  const sb = adminClient();
  const [p, users] = await Promise.all([
    sb.from("cap_partners").select("id,name,last_name,tax_id_norm,email,phone,user_id,import_id,status,classification,created_at,updated_at"),
    sb.from("profiles").select("id,email,role,name"),
  ]);
  if (p.error) fail(p.error);
  return { partners: (p.data ?? []) as (Existing & { last_name: string | null; import_id: string | null; status: string; classification: string; created_at: string; updated_at: string })[], users: (users.data ?? []) as { id: string; email: string; role: string; name: string }[] };
}
const sha = (rows: unknown) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
/** Vista d'una fila sense DNI complet (només els 4 últims caràcters). */
const masked = (r: ImportRow) => ({ ...r, taxId: r.taxId ? `•••${r.taxId.slice(-4)}` : null });

export async function previewImport(u: U, raw: unknown) {
  admin(u);
  const b = parse(importQ, raw);
  const { rows, headers } = normalizeRows(b.rows);
  if (headers.missing.length) {
    const names: Record<string, string> = { name: "Nom (Nombre)", email: "Correu (Email)" };
    const found = Object.keys(b.rows[0] ?? {}).filter((k) => !k.startsWith("__")).slice(0, 15);
    throw new HttpError(400, `No es troba la columna ${headers.missing.map((m) => names[m] ?? m).join(" ni la ")}. Columnes llegides: ${found.length ? found.join(", ") : "cap (potser la fila de capçaleres no és a dalt de tot)"}.`);
  }
  const ex = await existing();
  const prev = await adminClient().from("cap_partner_imports").select("id,file_name,created_at").eq("file_sha256", sha(b.rows)).is("undone_at", null).limit(1);
  const items = rows.map((r) => ({ row: masked(r), proposal: propose(r, ex.partners, ex.users) }));
  const count = (a: Proposal["action"]) => items.filter((x) => x.proposal.action === a).length;
  return {
    headers: headers.map, unknownColumns: headers.unknown, items,
    summary: { total: rows.length, collaborators: rows.filter((r) => r.classification === "collaborador").length, pending: rows.filter((r) => r.classification === "pendent_classificacio").length, crear: count("crear"), actualitzar: count("actualitzar"), revisar: count("revisar"), ignorar: count("ignorar"), withoutRepresentative: rows.filter((r) => !r.representative).length },
    alreadyImported: prev.data?.[0] ?? null,
  };
}

const confirmQ = importQ.extend({
  decisions: z.array(z.object({ index: z.number().int().min(0), action: z.enum(["crear", "actualitzar", "ignorar", "revisar"]) })).max(2000),
  enable: z.boolean().default(false),
});
export async function confirmImport(u: U, raw: unknown) {
  admin(u);
  const b = parse(confirmQ, raw);
  const { rows } = normalizeRows(b.rows);
  const ex = await existing();
  const sb = adminClient();
  const imp = await sb.from("cap_partner_imports").insert({ file_name: b.fileName, file_sha256: sha(b.rows), rows_total: rows.length, created_by: u.user.id }).select("id").single();
  if (imp.error) fail(imp.error);
  const importId = imp.data!.id as string;
  const report: { index: number; name: string; action: string; result: string; partnerId?: string; filled?: string[] }[] = [];
  const created: string[] = [];
  let updated = 0, skipped = 0, pending = 0;
  for (const r of rows) {
    const p = propose(r, ex.partners, ex.users);
    const want = b.decisions.find((d) => d.index === r.index)?.action ?? p.action;
    // la decisió de l'usuari no pot saltar-se els controls: no es crea si hi ha coincidències ni s'actualitza sense DNI coincident
    const action = want === "crear" && p.matches.length ? "revisar" : want === "actualitzar" && !(p.action === "actualitzar" && p.target) ? "revisar" : r.errors.length ? "ignorar" : want;
    if (action === "ignorar" || action === "revisar") { skipped++; report.push({ index: r.index, name: r.fullName, action, result: action === "revisar" ? `Pendent de revisió: ${p.reason}` : p.reason }); continue; }
    if (action === "crear") {
      const ins = await sb.from("cap_partners").insert({
        name: r.fullName, last_name: r.lastName, tax_id: r.taxId, person_kind: r.personKind, kind: "altres", email: r.email, phone: r.phone, address: r.address, postal_code: r.postalCode,
        city: r.city, province: r.province, source_label: r.label, source_created_at: r.createdAt, classification: r.classification,
        status: r.classification === "collaborador" ? "actiu" : "pendent", import_id: importId, created_by: u.user.id,
        notes: [r.warnings.length ? `Importació: ${r.warnings.join("; ")}` : null].filter(Boolean).join("\n") || null,
      }).select("id").single();
      if (ins.error) { skipped++; report.push({ index: r.index, name: r.fullName, action, result: ins.error.code === "23505" ? "Ja existeix (DNI repetit)" : "No s'ha pogut crear" }); continue; }
      created.push(ins.data.id);
      if (r.classification === "pendent_classificacio") pending++;
      report.push({ index: r.index, name: r.fullName, action, result: r.classification === "collaborador" ? "Creat com a col·laborador" : "Creat pendent de classificar (sense permisos)", partnerId: ins.data.id });
      continue;
    }
    // actualitzar: només es completen camps buits (no se sobreescriu cap dada existent)
    const cur = (await sb.from("cap_partners").select("*").eq("id", p.target!).single()).data as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const fill = (k: string, v: unknown) => { if (v != null && v !== "" && (cur[k] == null || cur[k] === "")) patch[k] = v; };
    fill("last_name", r.lastName); fill("email", r.email); fill("phone", r.phone); fill("address", r.address); fill("postal_code", r.postalCode); fill("city", r.city); fill("province", r.province);
    fill("person_kind", r.personKind); fill("source_label", r.label); fill("source_created_at", r.createdAt);
    if (Object.keys(patch).length) {
      const up = await sb.from("cap_partners").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", p.target!);
      if (up.error) fail(up.error);
      updated++;
    } else skipped++;
    report.push({ index: r.index, name: r.fullName, action, result: Object.keys(patch).length ? `Completats: ${Object.keys(patch).join(", ")}` : "Ja estava complet: sense canvis", partnerId: p.target!, filled: Object.keys(patch) });
  }
  await sb.from("cap_partner_imports").update({ created_count: created.length, updated_count: updated, skipped_count: skipped, pending_count: pending, report }).eq("id", importId);
  await secLog(u, "importacio_collaboradors", "cap_partner_imports", importId, { creats: created.length, actualitzats: updated, omesos: skipped });
  let enabled: Awaited<ReturnType<typeof enableAccounts>> | null = null;
  if (b.enable && created.length) enabled = await enableAccounts(u, { partnerIds: created });
  return { ok: true, importId, created: created.length, updated, skipped, pending, report, enabled };
}

export async function listImports(u: U) {
  admin(u);
  const r = await adminClient().from("cap_partner_imports").select("id,file_name,rows_total,created_count,updated_count,skipped_count,pending_count,created_at,undone_at,undo_report").order("created_at", { ascending: false }).limit(20);
  if (r.error) fail(r.error);
  return { imports: r.data ?? [] };
}

/** Desfer una importació (fins a 30 dies): només s'eliminen fitxes creades per la importació que no s'han fet servir. */
export async function undoImport(u: U, importId: string) {
  admin(u);
  const sb = adminClient();
  const imp = (await sb.from("cap_partner_imports").select("*").eq("id", importId).maybeSingle()).data;
  if (!imp) throw new HttpError(404, "Importació no trobada");
  if (imp.undone_at) throw new HttpError(409, "Aquesta importació ja s'ha desfet");
  if (Date.now() - new Date(imp.created_at).getTime() > 30 * 86_400_000) throw new HttpError(409, "Només es poden desfer importacions dels últims 30 dies");
  const created = ((await sb.from("cap_partners").select("id,name,user_id,updated_at,account_created_by_import").eq("import_id", importId)).data ?? []) as { id: string; name: string; user_id: string | null; updated_at: string; account_created_by_import: boolean }[];
  const removed: string[] = [], kept: { name: string; reason: string }[] = [];
  for (const p of created) {
    const reasons: string[] = [];
    const leads = await sb.from("crm_leads").select("id", { count: "exact", head: true }).eq("capture_partner_id", p.id);
    if (leads.count) reasons.push(`${leads.count} lead(s)`);
    if (p.user_id) {
      const [cl, ct, calc, led, set] = await Promise.all([
        sb.from("crm_clients").select("id", { count: "exact", head: true }).eq("collaborator_id", p.user_id),
        sb.from("crm_expedients").select("id", { count: "exact", head: true }).eq("collaborator_id", p.user_id),
        sb.from("fin_calculations").select("id", { count: "exact", head: true }).eq("beneficiary_id", p.user_id),
        sb.from("fin_ledger").select("id", { count: "exact", head: true }).eq("beneficiary_id", p.user_id),
        sb.from("fin_settlements").select("id", { count: "exact", head: true }).eq("beneficiary_id", p.user_id),
      ]);
      if (cl.count) reasons.push(`${cl.count} client(s)`);
      if (ct.count) reasons.push(`${ct.count} expedient(s)`);
      if (calc.count || led.count || set.count) reasons.push("comissions calculades o liquidades");
      if (!p.account_created_by_import) reasons.push("té un compte que no va crear la importació");
    }
    if (new Date(p.updated_at).getTime() - new Date(imp.created_at).getTime() > 5 * 60_000) reasons.push("s'ha modificat després de la importació");
    if (reasons.length) { kept.push({ name: p.name, reason: reasons.join(", ") }); continue; }
    if (p.user_id) {
      // regles del col·laborador creades per aquesta via (cap càlcul les fa servir: s'ha comprovat a dalt)
      await sb.from("fin_rules").delete().eq("beneficiary_id", p.user_id).eq("layer", "collaborador").like("rule_key", "collab_%");
      await sb.from("fin_collaborator_terms").delete().eq("user_id", p.user_id);
    }
    const del = await sb.from("cap_partners").delete().eq("id", p.id);
    if (del.error) { kept.push({ name: p.name, reason: "no s'ha pogut eliminar (té dades relacionades)" }); continue; }
    if (p.user_id) await sb.auth.admin.deleteUser(p.user_id);
    removed.push(p.name);
  }
  // els camps completats en fitxes existents es buiden només si encara tenen el valor importat
  const report = (imp.report ?? []) as { action: string; partnerId?: string; filled?: string[] }[];
  let restored = 0;
  for (const r of report.filter((x) => x.action === "actualitzar" && x.filled?.length && x.partnerId)) {
    const up = await sb.from("cap_partners").update(Object.fromEntries(r.filled!.map((k) => [k, null]))).eq("id", r.partnerId!).lte("updated_at", new Date(new Date(imp.created_at).getTime() + 5 * 60_000).toISOString());
    if (!up.error) restored++;
  }
  const undo = { removed, kept, restored };
  await sb.from("cap_partner_imports").update({ undone_at: new Date().toISOString(), undone_by: u.user.id, undo_report: undo }).eq("id", importId);
  await secLog(u, "importacio_collaboradors_desfeta", "cap_partner_imports", importId, { eliminats: removed.length, conservats: kept.length });
  return { ok: true, ...undo };
}

/* ======================================================================= comptes i accés */

/** Crea el compte per a comissions BLOQUEJAT: sense contrasenya, sense invitació i sense poder entrar. */
export async function enableAccounts(u: U, raw: unknown) {
  admin(u);
  const b = parse(z.object({ partnerIds: z.array(uuid).min(1).max(300) }), raw);
  const sb = adminClient();
  const ps = ((await sb.from("cap_partners").select("id,name,email,tax_id,user_id,classification,import_id").in("id", b.partnerIds)).data ?? []) as { id: string; name: string; email: string | null; tax_id: string | null; user_id: string | null; classification: string; import_id: string | null }[];
  const profiles = ((await sb.from("profiles").select("id,email")).data ?? []) as { id: string; email: string }[];
  const done: string[] = [], skipped: { name: string; reason: string }[] = [];
  for (const p of ps) {
    if (p.user_id) { skipped.push({ name: p.name, reason: "Ja està habilitat" }); continue; }
    if (p.classification !== "collaborador") { skipped.push({ name: p.name, reason: "Està pendent de classificar" }); continue; }
    if (!p.email) { skipped.push({ name: p.name, reason: "Falta el correu" }); continue; }
    if (profiles.some((x) => x.email?.toLowerCase() === p.email!.toLowerCase())) { skipped.push({ name: p.name, reason: "El correu ja és d'un usuari del CRM: no es modifica (cal revisar-ho)" }); continue; }
    const cu = await sb.auth.admin.createUser({ email: p.email, email_confirm: false, ban_duration: BAN, user_metadata: { name: p.name }, app_metadata: { access: "bloquejat", origin: "collaborador" } });
    if (cu.error || !cu.data.user) { skipped.push({ name: p.name, reason: cu.error?.message ?? "No s'ha pogut crear" }); continue; }
    const id = cu.data.user.id;
    const pr = await sb.from("profiles").upsert({ id, name: p.name, email: p.email, role: "colaborador", code: null });
    if (pr.error) { await sb.auth.admin.deleteUser(id); skipped.push({ name: p.name, reason: "No s'ha pogut crear el perfil" }); continue; }
    await sb.from("fin_collaborator_terms").upsert({ user_id: id, legal_name: p.name, tax_id: p.tax_id, billing_email: p.email, active: true, updated_by: u.user.id });
    await sb.from("cap_partners").update({ user_id: id, account_created_by_import: !!p.import_id, updated_at: new Date().toISOString() }).eq("id", p.id);
    done.push(p.name);
  }
  if (done.length) await secLog(u, "collaboradors_habilitats", "cap_partners", null, { n: done.length, acces: "bloquejat" });
  return { ok: true, enabled: done.length, skipped };
}

/** Donar accés al portal: desbloqueja el compte i envia (des del correu corporatiu) l'enllaç per crear la contrasenya. Retorna l'enllaç perquè Direcció també el pugui enviar pel seu compte. */
export async function grantPortalAccess(u: U, partnerId: string, origin: string) {
  admin(u);
  const sb = adminClient();
  const p = (await sb.from("cap_partners").select("id,name,email,user_id").eq("id", partnerId).maybeSingle()).data;
  if (!p?.user_id || !p.email) throw new HttpError(409, "Primer cal habilitar-lo per a comissions (i ha de tenir correu)");
  const up = await sb.auth.admin.updateUserById(p.user_id, { ban_duration: "none", app_metadata: { access: "portal" } });
  if (up.error) throw new HttpError(400, up.error.message);
  const a = await issueAccessLink({ email: p.email, name: p.name, kind: "recovery", next: "/collaboradors", origin, portal: true, sender: { email: u.profile.email, name: u.profile.name } });
  await secLog(u, "collaborador_acces_portal", "cap_partners", partnerId, { enviat: a.emailSent });
  return { ok: true, link: a.link, emailSent: a.emailSent, emailError: a.emailError };
}

/* ======================================================================= nivells i percentatges */

export async function getLevels(u: U) {
  if (!(await finStaff(u))) throw new HttpError(403, "Sense permís");
  const r = await u.sb.from("sec_settings").select("value").eq("key", "collab_levels").maybeSingle();
  return { levels: cleanLevels(r.data?.value ?? DEFAULT_LEVELS), canEdit: u.profile.role === "admin", canManage: await canManage(u) };
}

const levelItem = z.object({ label: z.string().trim().min(1).max(40), pct: z.union([z.string(), z.number()]).refine(validPct, "Percentatge entre 0 i 100") });
const levelsQ = z.object({
  levels: z.object({ n1: levelItem, n2: levelItem, n3: levelItem }),
  applyFrom: day.nullish(), reason: z.string().trim().max(300).nullish(),
});
/** Canviar els nivells per defecte. Opcionalment, aplicar el nou valor als col·laboradors d'aquell nivell des d'una data. */
export async function saveLevels(u: U, raw: unknown) {
  admin(u);
  const b = parse(levelsQ, raw);
  const old = (await getLevels(u)).levels;
  const levels = Object.fromEntries(LEVEL_KEYS.map((k) => [k, { label: b.levels[k].label, pct: Number(String(b.levels[k].pct).replace(",", ".")) }])) as Levels;
  const r = await u.sb.from("sec_settings").upsert({ key: "collab_levels", value: levels, updated_by: u.user.id, updated_at: new Date().toISOString() });
  if (r.error) fail(r.error);
  await secLog(u, "nivells_comissio", "sec_settings", "collab_levels", { abans: old, despres: levels });
  let applied = 0;
  if (b.applyFrom) {
    for (const k of LEVEL_KEYS) {
      if (old[k].pct === levels[k].pct) continue;
      const cur = await currentGenerals(u);
      const ids = [...cur.values()].filter((x) => x.level === k).map((x) => x.userId);
      if (ids.length) applied += (await setGeneral(u, { userIds: ids, level: k, validFrom: b.applyFrom, reason: b.reason ?? `Canvi del ${levels[k].label}: ${old[k].pct} % → ${levels[k].pct} %` }, levels)).changed;
    }
  }
  return { ok: true, applied };
}

type RuleLite = { id: string; rule_key: string; version: number; value: string; valid_from: string; valid_to: string | null; status: string; conditions: Record<string, unknown>; beneficiary_id: string; retailer: string | null; product: string | null; service: string | null; segment: string | null; notes: string | null; created_at: string; approved_at: string | null; created_by: string | null };
async function collabRules(u: U, userIds?: string[]) {
  let q = u.sb.from("fin_rules").select("id,rule_key,version,value,valid_from,valid_to,status,conditions,beneficiary_id,retailer,product,service,segment,notes,created_at,approved_at,created_by").eq("layer", "collaborador").eq("kind", "pct_comissio_rebuda").not("beneficiary_id", "is", null);
  if (userIds) q = q.in("beneficiary_id", userIds);
  const r = await q.order("version", { ascending: false });
  if (r.error) fail(r.error);
  return (r.data ?? []) as RuleLite[];
}
/** Regla general vigent avui (o pendent) de cada col·laborador. */
async function currentGenerals(u: U, userIds?: string[]) {
  const rules = await collabRules(u, userIds);
  const t = today();
  const out = new Map<string, { userId: string; pct: string; level: string; validFrom: string; status: string; next: { pct: string; validFrom: string; status: string } | null }>();
  for (const r of rules.filter((x) => x.rule_key === ruleKey(x.beneficiary_id) && ["aprovada", "pendent_aprovacio"].includes(x.status))) {
    const isNow = r.valid_from <= t && (!r.valid_to || r.valid_to >= t);
    const cur = out.get(r.beneficiary_id);
    const entry = { pct: String(Number(r.value)), level: String(r.conditions?.level ?? "personalitzat"), validFrom: r.valid_from, status: r.status };
    if (isNow && (!cur || cur.validFrom > t)) out.set(r.beneficiary_id, { userId: r.beneficiary_id, ...entry, next: cur && cur.validFrom > t ? { pct: cur.pct, validFrom: cur.validFrom, status: cur.status } : null });
    else if (!isNow && r.valid_from > t && !cur) out.set(r.beneficiary_id, { userId: r.beneficiary_id, ...entry, next: null });
    else if (!isNow && r.valid_from > t && cur && !cur.next) cur.next = { pct: entry.pct, validFrom: entry.validFrom, status: entry.status };
  }
  return out;
}

const generalQ = z.object({
  userIds: z.array(uuid).min(1).max(500),
  level: z.enum(["n1", "n2", "n3", "personalitzat"]),
  pct: z.union([z.string(), z.number()]).nullish(),
  validFrom: day, reason: z.string().trim().max(300).nullish(),
});
/** Assigna el percentatge general (individual o massiu). Crea una versió nova de la regla: l'històric es conserva. */
export async function setGeneral(u: U, raw: unknown, levelsOverride?: Levels) {
  if (!(await canManage(u))) throw new HttpError(403, "Només Direcció o la Cap administrativa autoritzada poden canviar percentatges");
  const b = parse(generalQ, raw);
  if (b.validFrom < today()) throw new HttpError(400, "La data d'efecte no pot ser anterior a avui: les comissions ja meritades conserven el percentatge que tenien");
  const levels = levelsOverride ?? (await getLevels(u)).levels;
  const pct = b.level === "personalitzat" ? String(b.pct ?? "").replace(",", ".") : String(levels[b.level].pct);
  if (!validPct(pct)) throw new HttpError(400, "Percentatge no vàlid (entre 0 i 100, fins a 4 decimals)");
  const level = b.level === "personalitzat" ? levelOf(pct, levels) === "personalitzat" ? "personalitzat" : levelOf(pct, levels) : b.level;
  const names = new Map((((await u.sb.from("profiles").select("id,name,role").in("id", b.userIds)).data ?? []) as { id: string; name: string; role: string }[]).map((p) => [p.id, p]));
  const all = await collabRules(u, b.userIds);
  const status = u.profile.role === "admin" ? "aprovada" : "pendent_aprovacio";
  let changed = 0; const skipped: { name: string; reason: string }[] = [];
  for (const id of b.userIds) {
    const p = names.get(id);
    if (!p || p.role !== "colaborador") { skipped.push({ name: p?.name ?? id, reason: "No és un col·laborador habilitat per a comissions" }); continue; }
    const mine = all.filter((r) => r.rule_key === ruleKey(id));
    const last = mine[0];
    if (last && D(last.value).eq(pct) && last.valid_from <= b.validFrom && ["aprovada", "pendent_aprovacio"].includes(last.status) && !last.valid_to) { skipped.push({ name: p.name, reason: "Ja té aquest percentatge" }); continue; }
    if (last && last.valid_from > b.validFrom && last.status === "aprovada") { skipped.push({ name: p.name, reason: `Ja hi ha un canvi aprovat amb efecte ${last.valid_from}` }); continue; }
    // una versió pendent anterior (no aprovada) es retira perquè no quedin dues propostes alhora
    for (const r of mine.filter((x) => x.status === "pendent_aprovacio")) await u.sb.from("fin_rules").update({ status: "retirada" }).eq("id", r.id);
    const ins = await u.sb.from("fin_rules").insert({
      rule_key: ruleKey(id), version: (last?.version ?? 0) + 1, name: `Col·laborador · ${p.name} · general`, layer: "collaborador", beneficiary_id: id,
      kind: "pct_comissio_rebuda", value: pct, unit: "pct", conditions: { level, origin: "fitxa_collaborador", reason: b.reason ?? null, previous: last ? String(Number(last.value)) : null },
      base_formula: BASE_FORMULA, base_validated: true, valid_from: b.validFrom, status, notes: b.reason ?? null, created_by: u.user.id,
    });
    if (ins.error) { skipped.push({ name: p.name, reason: ins.error.message }); continue; }
    changed++;
  }
  return { ok: true, changed, skipped, status };
}

const exceptionQ = z.object({
  userId: uuid, pct: z.union([z.string(), z.number()]).refine(validPct, "Percentatge entre 0 i 100"),
  retailer: z.string().trim().max(120).nullish(), product: z.string().trim().max(120).nullish(),
  service: z.enum(["llum_residencial", "llum_empresa", "gas", "fibra_telefonia", "assegurances", "alarmes"]).nullish(),
  segment: z.enum(["residencial", "pime", "gran_consum"]).nullish(), tariff: z.string().trim().max(20).nullish(),
  appliesTo: z.enum(["alta_nova", "renovacio"]).nullish(),
  validFrom: day, validTo: day.nullish(), reason: z.string().trim().max(300).nullish(),
});
/** Excepció: percentatge diferent per a una comercialitzadora, producte, servei, segment, tarifa o tipus de contracte. */
export async function addException(u: U, raw: unknown) {
  if (!(await canManage(u))) throw new HttpError(403, "Sense permís");
  const b = parse(exceptionQ, raw);
  if (!b.retailer && !b.product && !b.service && !b.segment && !b.tariff && !b.appliesTo) throw new HttpError(400, "Indica almenys un criteri (comercialitzadora, producte, servei, segment, tarifa o tipus de contracte)");
  if (b.validTo && b.validTo < b.validFrom) throw new HttpError(400, "La data final és anterior a la inicial");
  const p = (await u.sb.from("profiles").select("name,role").eq("id", b.userId).maybeSingle()).data;
  if (!p || p.role !== "colaborador") throw new HttpError(400, "No és un col·laborador habilitat per a comissions");
  const what = [b.retailer, b.product, b.service, b.segment, b.tariff, b.appliesTo === "alta_nova" ? "alta nova" : b.appliesTo].filter(Boolean).join(" · ");
  const r = await u.sb.from("fin_rules").insert({
    rule_key: `${ruleKey(b.userId)}_x${randomUUID().slice(0, 6)}`, version: 1, name: `Col·laborador · ${p.name} · ${what}`, layer: "collaborador", beneficiary_id: b.userId,
    retailer: b.retailer || null, product: b.product || null, service: b.service ?? null, segment: b.segment ?? null,
    kind: "pct_comissio_rebuda", value: String(b.pct).replace(",", "."), unit: "pct", conditions: { origin: "excepcio_collaborador", tariff: b.tariff || undefined, applies_to: b.appliesTo ?? undefined, reason: b.reason ?? null },
    base_formula: BASE_FORMULA, base_validated: true, valid_from: b.validFrom, valid_to: b.validTo ?? null, status: u.profile.role === "admin" ? "aprovada" : "pendent_aprovacio", notes: b.reason ?? null, created_by: u.user.id,
  });
  if (r.error) fail(r.error);
  return { ok: true };
}

export async function retireRule(u: U, ruleId: string) {
  if (!(await canManage(u))) throw new HttpError(403, "Sense permís");
  const r = await u.sb.from("fin_rules").update({ status: "retirada" }).eq("id", ruleId).eq("layer", "collaborador").like("rule_key", "collab_%").select("id");
  if (r.error) fail(r.error);
  if (!r.data?.length) throw new HttpError(404, "Regla no trobada");
  return { ok: true };
}

export async function approveRule(u: U, ruleId: string) {
  admin(u);
  const r = await u.sb.from("fin_rules").update({ status: "aprovada" }).eq("id", ruleId).eq("status", "pendent_aprovacio").like("rule_key", "collab_%").select("id");
  if (r.error) fail(r.error);
  if (!r.data?.length) throw new HttpError(404, "No hi ha cap proposta pendent amb aquest identificador");
  return { ok: true };
}

/* ======================================================================= consultes per a la pantalla */

/** Resum per al llistat: percentatge vigent de cada col·laborador habilitat. */
export async function commissionOverview(u: U) {
  if (!(await finStaff(u))) return { allowed: false as const, rows: {}, levels: DEFAULT_LEVELS, canManage: false, canApprove: false };
  const lv = await getLevels(u);
  const cur = await currentGenerals(u);
  const ex = await collabRules(u);
  const exceptions = new Map<string, number>();
  for (const r of ex) if (r.rule_key !== ruleKey(r.beneficiary_id) && r.status !== "retirada") exceptions.set(r.beneficiary_id, (exceptions.get(r.beneficiary_id) ?? 0) + 1);
  const rows = Object.fromEntries([...new Set([...cur.keys(), ...exceptions.keys()])].map((id) => [id, { ...(cur.get(id) ?? null), exceptions: exceptions.get(id) ?? 0 }]));
  return { allowed: true as const, rows, levels: lv.levels, canManage: lv.canManage, canApprove: u.profile.role === "admin" };
}

/** Fitxa de comissions d'un col·laborador: vigent, propers canvis, històric i excepcions. */
export async function commissionProfile(u: U, partnerId: string) {
  if (!(await finStaff(u))) throw new HttpError(403, "Sense permís per veure les condicions econòmiques");
  const p = (await u.sb.from("cap_partners").select("id,name,user_id,manager_id,classification,status").eq("id", partnerId).maybeSingle()).data;
  if (!p) throw new HttpError(404, "Col·laborador no trobat");
  const lv = await getLevels(u);
  if (!p.user_id) return { partner: p, enabled: false, levels: lv.levels, canManage: lv.canManage, history: [], exceptions: [], current: null, stats: null };
  const rules = await collabRules(u, [p.user_id]);
  const people = new Map((((await u.sb.from("profiles").select("id,name")).data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  const fmt = (r: RuleLite) => ({ id: r.id, version: r.version, pct: String(Number(r.value)), level: String(r.conditions?.level ?? ""), validFrom: r.valid_from, validTo: r.valid_to, status: r.status, reason: (r.conditions?.reason as string | null) ?? r.notes, previous: (r.conditions?.previous as string | null) ?? null, by: r.created_by ? people.get(r.created_by) ?? null : null, at: r.created_at, retailer: r.retailer, product: r.product, service: r.service, segment: r.segment, tariff: (r.conditions?.tariff as string | undefined) ?? null, appliesTo: (r.conditions?.applies_to as string | undefined) ?? null });
  const [calcs, ledger] = await Promise.all([
    u.sb.from("fin_calculations").select("status,amount").eq("layer", "collaborador").eq("beneficiary_id", p.user_id).eq("is_current", true),
    u.sb.from("fin_ledger").select("kind,amount,settlement_id").eq("layer", "collaborador").eq("beneficiary_id", p.user_id),
  ]);
  const L = (ledger.data ?? []) as { kind: string; amount: string; settlement_id: string | null }[];
  const s = (xs: (string | null)[]) => xs.reduce((a, x) => a.plus(x ?? 0), D(0)).toFixed(2);
  return {
    partner: p, enabled: true, levels: lv.levels, canManage: lv.canManage, canApprove: u.profile.role === "admin",
    current: (await currentGenerals(u, [p.user_id])).get(p.user_id) ?? null,
    history: rules.filter((r) => r.rule_key === ruleKey(p.user_id!)).map(fmt),
    exceptions: rules.filter((r) => r.rule_key !== ruleKey(p.user_id!)).map(fmt),
    stats: {
      forecast: s(((calcs.data ?? []) as { status: string; amount: string | null }[]).filter((c) => c.status === "calculat").map((c) => c.amount)),
      accrued: s(L.filter((x) => x.kind !== "retrocessio" && x.kind !== "anullacio").map((x) => x.amount)),
      retrocessions: s(L.filter((x) => x.kind === "retrocessio" || x.kind === "anullacio").map((x) => x.amount)),
      settled: s(L.filter((x) => x.settlement_id).map((x) => x.amount)),
    },
  };
}

/* ======================================================================= accions massives sobre la fitxa */

const bulkQ = z.object({ partnerIds: z.array(uuid).min(1).max(500), action: z.enum(["activar", "desactivar", "classificar_collaborador", "descartar"]), managerId: uuid.nullish() });
export async function bulkPartners(u: U, raw: unknown) {
  admin(u);
  const b = parse(bulkQ, raw);
  const sb = adminClient();
  const patch = b.action === "activar" ? { status: "actiu" } : b.action === "desactivar" ? { status: "suspes" } : b.action === "classificar_collaborador" ? { classification: "collaborador" } : { classification: "descartat", status: "baixa" };
  const r = await sb.from("cap_partners").update({ ...patch, updated_at: new Date().toISOString() }).in("id", b.partnerIds).select("id,user_id");
  if (r.error) fail(r.error);
  const users = (r.data ?? []).map((x) => x.user_id).filter(Boolean) as string[];
  if (users.length && (b.action === "activar" || b.action === "desactivar")) await sb.from("fin_collaborator_terms").update({ active: b.action === "activar" }).in("user_id", users);
  await secLog(u, `collaboradors_${b.action}`, "cap_partners", null, { n: r.data?.length ?? 0 });
  return { ok: true, changed: r.data?.length ?? 0 };
}

export async function setManager(u: U, raw: unknown) {
  admin(u);
  const b = parse(z.object({ partnerIds: z.array(uuid).min(1).max(500), managerId: uuid.nullable() }), raw);
  if (b.managerId) {
    const m = (await u.sb.from("profiles").select("role").eq("id", b.managerId).maybeSingle()).data;
    if (!m || !["admin", "cap_administrativa", "cap_equip", "comercial"].includes(m.role)) throw new HttpError(400, "El responsable ha de ser un usuari intern");
  }
  const r = await adminClient().from("cap_partners").update({ manager_id: b.managerId, updated_at: new Date().toISOString() }).in("id", b.partnerIds);
  if (r.error) fail(r.error);
  return { ok: true };
}

export async function exportPartners(u: U, idsRaw: string) {
  admin(u);
  const ids = idsRaw.split(",").filter((x) => uuid.safeParse(x).success);
  let q = adminClient().from("cap_partners").select("id,name,last_name,tax_id,person_kind,email,phone,address,postal_code,city,province,source_label,classification,status,user_id,created_at").order("name");
  if (ids.length) q = q.in("id", ids);
  const r = await q;
  if (r.error) fail(r.error);
  const ov = await commissionOverview(u);
  const rows = (r.data ?? []).map((p) => { const c = p.user_id && ov.allowed ? (ov.rows as Record<string, { pct?: string; level?: string; validFrom?: string }>)[p.user_id] : undefined; return [p.name, p.tax_id, p.person_kind, p.email, p.phone, p.address, p.postal_code, p.city, p.province, p.source_label, p.classification, p.status, p.user_id ? "Sí" : "No", c?.pct ?? "", c?.level ?? "", c?.validFrom ?? ""]; });
  await secLog(u, "exportacio_collaboradors", "cap_partners", null, { n: rows.length });
  return { csv: toCsv(["Nom", "DNI/CIF", "Persona", "Correu", "Telèfon", "Adreça", "CP", "Població", "Província", "Etiqueta origen", "Classificació", "Estat", "Habilitat comissions", "% general", "Nivell", "Vigent des de"], rows), fileName: `collaboradors_${today()}.csv` };
}

/* ======================================================================= edició de la fitxa */

const editQ = z.object({
  name: z.string().trim().min(2, "Escriu el nom").max(160),
  company: z.string().trim().max(160).nullish(), public_name: z.string().trim().max(80).nullish(),
  kind: z.enum(["electricista", "fotovoltaica", "gas", "immobiliaria", "administrador_finques", "gestoria", "corredoria", "altres"]),
  tax_id: z.string().trim().max(20).nullish(), email: z.string().trim().toLowerCase().max(160).nullish(),
  phone: z.string().trim().max(30).nullish(), address: z.string().trim().max(300).nullish(), postal_code: z.string().trim().max(10).nullish(),
  city: z.string().trim().max(80).nullish(), province: z.string().trim().max(60).nullish(), notes: z.string().trim().max(2000).nullish(),
});
/** Direcció corregeix les dades de la fitxa. No toca el compte d'accés (el correu d'inici de sessió no canvia). */
export async function editPartner(u: U, id: string, raw: unknown) {
  admin(u);
  const b = parse(editQ, raw);
  const nil = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const tax = nil(b.tax_id)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? null;
  if (tax && !validTaxId(tax)) throw new HttpError(400, `El DNI/CIF «${tax}» no és vàlid (format o lletra de control)`);
  const email = nil(b.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Correu no vàlid");
  const cp = nil(b.postal_code);
  if (cp && !/^\d{5}$/.test(cp)) throw new HttpError(400, "El codi postal ha de tenir 5 xifres");
  const sb = adminClient();
  const cur = (await sb.from("cap_partners").select("*").eq("id", id).maybeSingle()).data as Record<string, unknown> | null;
  if (!cur) throw new HttpError(404, "Col·laborador no trobat");
  const others = ((await sb.from("cap_partners").select("id,name,tax_id_norm,email").neq("id", id)).data ?? []) as { id: string; name: string; tax_id_norm: string | null; email: string | null }[];
  const dupTax = tax ? others.find((o) => o.tax_id_norm === tax) : null;
  if (dupTax) throw new HttpError(409, `Aquest DNI/CIF ja el té ${dupTax.name}`);
  const dupMail = email ? others.find((o) => (o.email ?? "").toLowerCase() === email) : null;
  if (dupMail) throw new HttpError(409, `Aquest correu ja el té ${dupMail.name}`);
  const patch: Record<string, unknown> = {
    name: b.name, company: nil(b.company), public_name: nil(b.public_name), kind: b.kind, tax_id: tax, person_kind: personKind(tax) ?? cur.person_kind ?? null,
    email, phone: nil(b.phone), address: nil(b.address), postal_code: cp, city: nil(b.city), province: nil(b.province), notes: nil(b.notes),
  };
  const changed = Object.keys(patch).filter((k) => (patch[k] ?? null) !== (cur[k] ?? null));
  if (!changed.length) return { ok: true, changed: [] as string[], warning: null };
  const r = await sb.from("cap_partners").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (r.error) fail(r.error);
  let warning: string | null = null;
  if (cur.user_id) {
    // dades de liquidació i nom visible als càlculs; el correu d'accés NO es modifica
    await sb.from("fin_collaborator_terms").update({ legal_name: nil(b.company) ?? b.name, tax_id: tax, updated_by: u.user.id }).eq("user_id", cur.user_id as string);
    await sb.from("profiles").update({ name: b.name }).eq("id", cur.user_id as string);
    if (changed.includes("email")) warning = "El correu de la fitxa s'ha canviat, però el correu d'inici de sessió del compte continua sent l'anterior.";
  }
  await secLog(u, "collaborador_editat", "cap_partners", id, { camps: changed });
  return { ok: true, changed, warning };
}
