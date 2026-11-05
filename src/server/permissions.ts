import "server-only";
/**
 * PERMISOS, SEGURETAT I AUDITORIA (Fase 7) · servidor.
 * - Els permisos efectius surten de la base de dades (my_permissions() / has_perm()), que és la mateixa funció
 *   que aplica la RLS: el servidor i la base de dades no poden discrepar.
 * - Si la migració 014 no és aplicada, es fa servir el comportament de la Fase 6 (per rol) i s'indica.
 * - requireInternal(): CRM intern; els col·laboradors només tenen el portal (/collaboradors).
 * - MFA per a rols sensibles quan Direcció l'activa (Supabase Auth TOTP: nivell aal2).
 */
import { z } from "zod";
import { ROLES } from "@/core/roles";
import { MODULES, legacyPerms as legacyMap, toMap, type Action, type Perm, type PermMap } from "@/core/permissions";
import { HttpError, adminClient, requireUser } from "./supabase";

type U = Awaited<ReturnType<typeof requireUser>>;
const cache = new WeakMap<object, Promise<{ map: PermMap; migrated: boolean }>>();
const STAFF = ["admin", "cap_administrativa", "administrativa"];
const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42883" || e.code === "42P01" || e.code === "PGRST202" || /does not exist|Could not find the function/i.test(e.message ?? ""));

export async function permissions(u: U) {
  let p = cache.get(u);
  if (!p) {
    p = (async () => {
      if (u.profile.role === "admin") return { map: Object.fromEntries(MODULES.map((m) => [m.id, { read: true, edit: true, approve: true }])) as PermMap, migrated: true };
      const { data, error } = await u.sb.rpc("my_permissions");
      if (error) {
        if (isMissing(error)) return { map: legacyMap(u.profile.role), migrated: false };
        throw new HttpError(500, "No s'han pogut llegir els permisos");
      }
      return { map: toMap(data as Perm[]), migrated: true };
    })();
    cache.set(u, p);
  }
  return p;
}

export async function hasPerm(u: U, module: string, action: Action = "read") {
  if (u.profile.role === "admin") return true;
  return !!(await permissions(u)).map[module]?.[action];
}
export async function requirePerm(u: U, module: string, action: Action = "read") {
  if (!(await hasPerm(u, module, action))) throw new HttpError(403, `No tens permís ${action === "read" ? "de lectura" : action === "edit" ? "d'edició" : "d'aprovació"} a «${MODULES.find((m) => m.id === module)?.label ?? module}»`);
}
/** Dades econòmiques restringides: Direcció, o personal d'administració autoritzat per Direcció. */
export async function finStaff(u: U, action: "read" | "edit" = "read") {
  if (u.profile.role === "admin") return true;
  if (!STAFF.includes(u.profile.role)) return false;
  return hasPerm(u, "economia", action);
}

/* ======================================================================= MFA i accés intern */

let secCache: { at: number; mfa: { enforced: boolean; roles: string[] } } | null = null;
export async function mfaPolicy() {
  if (secCache && Date.now() - secCache.at < 60_000) return secCache.mfa;
  let mfa = { enforced: false, roles: ["admin", "cap_administrativa"] };
  try {
    const { data } = await adminClient().from("sec_settings").select("value").eq("key", "mfa").maybeSingle();
    if (data?.value) mfa = { enforced: !!data.value.enforced, roles: Array.isArray(data.value.roles) ? data.value.roles : mfa.roles };
  } catch { /* sense migració o sense clau de servei: no s'exigeix */ }
  secCache = { at: Date.now(), mfa };
  return mfa;
}
export const invalidateSecurityCache = () => { secCache = null; };

export async function assurance(u: U) {
  try {
    const r = await u.sb.auth.mfa.getAuthenticatorAssuranceLevel();
    return { current: r.data?.currentLevel ?? "aal1", next: r.data?.nextLevel ?? "aal1" };
  } catch { return { current: "aal1", next: "aal1" }; }
}

/** CRM intern: rebutja col·laboradors i, si Direcció ho ha activat, exigeix MFA als rols sensibles. */
export async function requireInternal(opts: { admin?: boolean; staff?: boolean } = {}) {
  const u = await requireUser(opts);
  if (u.profile.role === "colaborador") throw new HttpError(403, "El CRM intern no és accessible per a col·laboradors. Entra al portal: /collaboradors");
  const mfa = await mfaPolicy();
  if (mfa.enforced && mfa.roles.includes(u.profile.role)) {
    const a = await assurance(u);
    if (a.current !== "aal2") throw new HttpError(403, a.next === "aal2" ? "MFA_REQUIRED: cal verificar el segon factor" : "MFA_ENROLL: cal configurar la verificació en dos passos");
  }
  return u;
}

/* ======================================================================= auditoria */

export async function secLog(u: U | null, action: string, entity: string, entityId: string | null, detail: Record<string, unknown> | null = null) {
  try {
    if (u) {
      const { error } = await u.sb.rpc("sec_log", { p_action: action, p_entity: entity, p_entity_id: entityId, p_detail: detail });
      if (!error) return;
    }
    // operacions fetes amb la clau de servei (p. ex. /api/users): es registra l'autor explícitament
    await adminClient().from("sec_audit").insert({ actor_id: u?.user.id ?? null, actor_name: u?.profile.name ?? "Sistema", action, entity, entity_id: entityId, detail });
  } catch { /* l'auditoria no ha d'aturar l'operació; l'error queda al registre del servidor */ }
}

export async function auditLog(u: U, raw: Record<string, string>) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció consulta l'auditoria de seguretat");
  let q = u.sb.from("sec_audit").select("*").order("at", { ascending: false }).limit(Math.min(500, Number(raw.limit) || 200));
  if (raw.action) q = q.eq("action", raw.action);
  if (raw.from) q = q.gte("at", raw.from);
  const { data, error } = await q;
  if (error) { if (isMissing(error)) return { rows: [], migrated: false }; throw new HttpError(500, error.message); }
  return { rows: data ?? [], migrated: true };
}

/* ======================================================================= gestió de permisos (Direcció) */

export async function permissionMatrix(u: U) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció gestiona els permisos");
  const [roles, users, people, mfa, reports] = await Promise.all([
    u.sb.from("role_permissions").select("role,module,can_read,can_edit,can_approve,updated_at"),
    u.sb.from("user_permissions").select("user_id,module,can_read,can_edit,can_approve,note,updated_at"),
    u.sb.from("profiles").select("id,name,email,role,code").order("name"),
    u.sb.from("sec_settings").select("value").eq("key", "mfa").maybeSingle(),
    u.sb.from("sec_settings").select("value").eq("key", "reports").maybeSingle(),
  ]);
  if (roles.error && isMissing(roles.error)) return { migrated: false, modules: MODULES, roles: [], overrides: [], people: people.data ?? [], mfa: null, reports: null, me: await assurance(u) };
  return { migrated: true, modules: MODULES, roles: roles.data ?? [], overrides: users.data ?? [], people: people.data ?? [], mfa: mfa.data?.value ?? null, reports: reports.data?.value ?? null, me: await assurance(u) };
}

const permRow = z.object({ module: z.string().min(1).max(40).refine((m) => MODULES.some((x) => x.id === m), "Mòdul desconegut"), read: z.boolean(), edit: z.boolean(), approve: z.boolean() });
export async function setRolePermission(u: U, raw: unknown) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció gestiona els permisos");
  const b = permRow.extend({ role: z.enum(ROLES as [string, ...string[]]) }).parse(raw);
  if (b.role === "admin") throw new HttpError(400, "Direcció té sempre tots els permisos (no es pot restringir per evitar quedar sense accés)");
  const { error } = await u.sb.from("role_permissions").upsert({ role: b.role, module: b.module, can_read: b.read || b.edit || b.approve, can_edit: b.edit, can_approve: b.approve, updated_by: u.user.id, updated_at: new Date().toISOString() }, { onConflict: "role,module" });
  if (error) throw new HttpError(400, error.message);
  return { ok: true };
}
export async function setUserPermission(u: U, raw: unknown) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció gestiona els permisos");
  const b = z.object({ userId: z.string().uuid(), module: permRow.shape.module, value: z.object({ read: z.boolean(), edit: z.boolean(), approve: z.boolean() }).nullable(), note: z.string().max(300).optional() }).parse(raw);
  if (b.value === null) {
    const { error } = await u.sb.from("user_permissions").delete().eq("user_id", b.userId).eq("module", b.module);
    if (error) throw new HttpError(400, error.message);
    return { ok: true };
  }
  const { data: target } = await u.sb.from("profiles").select("role").eq("id", b.userId).maybeSingle();
  if (!target) throw new HttpError(404, "Usuari no trobat");
  if (target.role === "colaborador" && b.module !== "portal" && (b.value.read || b.value.edit || b.value.approve) && !["tasques", "informes", "comissions"].includes(b.module))
    throw new HttpError(400, "Un col·laborador només pot tenir accés al seu portal");
  const { error } = await u.sb.from("user_permissions").upsert({ user_id: b.userId, module: b.module, can_read: b.value.read || b.value.edit || b.value.approve, can_edit: b.value.edit, can_approve: b.value.approve, note: b.note ?? null, granted_by: u.user.id, updated_at: new Date().toISOString() }, { onConflict: "user_id,module" });
  if (error) throw new HttpError(400, error.message);
  return { ok: true };
}

export async function setSecurity(u: U, raw: unknown) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció canvia la seguretat");
  const b = z.object({ mfa: z.object({ enforced: z.boolean(), roles: z.array(z.enum(["admin", "cap_administrativa", "cap_equip", "administrativa", "comercial"])).max(5) }).optional(), reports: z.object({ diari: z.array(z.string().uuid()).max(20), setmanal: z.array(z.string().uuid()).max(20), mensual: z.array(z.string().uuid()).max(20) }).optional() }).parse(raw);
  if (b.mfa) {
    // per no deixar Direcció fora: només es pot activar havent verificat el propi segon factor en aquesta sessió
    if (b.mfa.enforced && b.mfa.roles.includes(u.profile.role) && (await assurance(u)).current !== "aal2") throw new HttpError(400, "Abans d'exigir MFA, configura i verifica el teu segon factor (Configuració → Seguretat)");
    const { error } = await u.sb.from("sec_settings").upsert({ key: "mfa", value: b.mfa, updated_by: u.user.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw new HttpError(400, error.message);
    await secLog(u, "mfa_politica", "sec_settings", "mfa", b.mfa);
    invalidateSecurityCache();
  }
  if (b.reports) {
    // destinataris: només persones internes amb accés a informes
    const ids = [...new Set([...b.reports.diari, ...b.reports.setmanal, ...b.reports.mensual])];
    if (ids.length) {
      const { data } = await u.sb.from("profiles").select("id,role").in("id", ids);
      const bad = (data ?? []).filter((p) => p.role === "colaborador" || p.role === "comercial");
      if (bad.length || (data ?? []).length !== ids.length) throw new HttpError(400, "Els informes automàtics globals només es poden enviar a Direcció i a l'equip d'administració");
    }
    const { error } = await u.sb.from("sec_settings").upsert({ key: "reports", value: b.reports, updated_by: u.user.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw new HttpError(400, error.message);
    await secLog(u, "destinataris_informes", "sec_settings", "reports", { total: ids.length });
  }
  return { ok: true };
}

/** Menú i capacitats de la sessió actual (la interfície només amaga; el servidor i la RLS decideixen). */
export async function sessionInfo(u: U) {
  const p = await permissions(u);
  const mfa = await mfaPolicy();
  const a = await assurance(u);
  return { role: u.profile.role, perms: p.map, migrated: p.migrated, mfa: { required: mfa.enforced && mfa.roles.includes(u.profile.role), current: a.current, next: a.next }, economic: await finStaff(u) };
}
