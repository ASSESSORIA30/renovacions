import { HttpError, adminClient, handler } from "@/server/supabase";
import { requireInternal, secLog } from "@/server/permissions";
import { issueAccessLink } from "@/server/access-link";

const ROLES = ["admin", "cap_administrativa", "cap_equip", "administrativa", "comercial", "colaborador"] as const;
const clean = (s: unknown, max = 120) => (typeof s === "string" ? s.trim().slice(0, max) : "");

/** List users (admin). */
export const GET = handler(async () => {
  await requireInternal({ admin: true });
  const sb = adminClient();
  const { data: profiles, error } = await sb.from("profiles").select("*").order("created_at");
  if (error) throw error;
  const { data: auth } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const last = new Map((auth?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]));
  const banned = new Map((auth?.users ?? []).map((u) => [u.id, !!(u as { banned_until?: string | null }).banned_until && new Date((u as { banned_until?: string }).banned_until!) > new Date()]));
  const mfa = new Map((auth?.users ?? []).map((u) => [u.id, ((u as { factors?: { status: string }[] }).factors ?? []).some((f) => f.status === "verified")]));
  return profiles.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role, code: p.code, lastSignIn: last.get(p.id) ?? null, suspended: banned.get(p.id) ?? false, mfa: mfa.get(p.id) ?? false }));
});

/** Create a user (admin). With password → active immediately; without → Supabase sends an invitation email. */
export const POST = handler(async (req) => {
  const me = await requireInternal({ admin: true });
  const b = await req.json();
  const email = clean(b.email).toLowerCase(), name = clean(b.name), password = clean(b.password, 200);
  const role = ROLES.includes(b.role) ? b.role : "comercial";
  const code = clean(b.code, 40).toUpperCase() || null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Correu no vàlid");
  if (!name) throw new HttpError(400, "Falta el nom");
  if (password && password.length < 8) throw new HttpError(400, "La contrasenya ha de tenir almenys 8 caràcters");
  if (role === "comercial" && !code) throw new HttpError(400, "Un comercial necessita el seu codi (p. ex. IBETH) per veure els seus contractes");
  const sb = adminClient();
  const origin = new URL(req.url).origin;
  let id: string, access: Awaited<ReturnType<typeof issueAccessLink>> | null = null;
  if (password) {
    const created = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
    if (created.error) throw new HttpError(400, created.error.message.includes("already") ? "Ja existeix un usuari amb aquest correu" : created.error.message);
    id = created.data.user!.id;
  } else {
    // enllaç generat per Supabase però enviat des del correu corporatiu i cap a la pàgina /acces del CRM
    access = await issueAccessLink({ email, name, kind: "invite", next: role === "colaborador" ? "/collaboradors" : "/", origin, portal: role === "colaborador", sender: { email: me.profile.email, name: me.profile.name } });
    if (!access.userId) throw new HttpError(500, "No s'ha pogut crear l'usuari");
    id = access.userId;
  }
  const { error } = await sb.from("profiles").upsert({ id, name, email, role, code });
  if (error) throw error;
  await secLog(me, "alta_usuari", "profiles", id, { role });
  return { id, name, email, role, code, invited: !password, link: access?.link ?? null, emailSent: access?.emailSent ?? false, emailError: access?.emailError ?? null };
});

/** Update role / code / name (admin). */
export const PATCH = handler(async (req) => {
  const me = await requireInternal({ admin: true });
  const { profile } = me;
  const b = await req.json();
  const patch: Record<string, unknown> = {};
  if (b.name !== undefined) patch.name = clean(b.name);
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) throw new HttpError(400, "Rol no vàlid");
    if (b.id === profile.id && b.role !== "admin") throw new HttpError(400, "No et pots treure a tu mateix el rol d'administrador");
    patch.role = b.role;
  }
  if (b.code !== undefined) patch.code = clean(b.code, 40).toUpperCase() || null;
  const sb = adminClient();
  const id = clean(b.id, 64);
  const before = patch.role !== undefined ? ((await sb.from("profiles").select("role").eq("id", id).maybeSingle()).data?.role as string | undefined) : undefined;
  if (Object.keys(patch).length) {
    const { error } = await sb.from("profiles").update(patch).eq("id", id);
    if (error) throw error;
  }
  // canvi de rol fet amb la clau de servei: el registra el servidor amb l'autor (la base de dades no el coneix)
  if (patch.role !== undefined && before !== patch.role) await secLog(me, "canvi_rol", "profiles", id, { abans: before ?? null, despres: patch.role });
  // suspendre / reactivar l'accés (p. ex. un col·laborador): no s'esborra res
  if (typeof b.suspended === "boolean") {
    if (id === profile.id) throw new HttpError(400, "No et pots suspendre a tu mateix");
    const r = await sb.auth.admin.updateUserById(id, { ban_duration: b.suspended ? "876000h" : "none" });
    if (r.error) throw new HttpError(400, r.error.message);
    await secLog(me, b.suspended ? "acces_suspes" : "acces_reactivat", "profiles", id, null);
  }
  if (b.password) {
    if (String(b.password).length < 8) throw new HttpError(400, "La contrasenya ha de tenir almenys 8 caràcters");
    const r = await sb.auth.admin.updateUserById(id, { password: String(b.password) });
    if (r.error) throw new HttpError(400, r.error.message);
    await secLog(me, "canvi_contrasenya", "profiles", id, null);
  }
  return { ok: true };
});

/** Delete a user (admin). Their history (activities, tasks) is kept. */
export const DELETE = handler(async (req) => {
  const me = await requireInternal({ admin: true });
  const { profile } = me;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (id === profile.id) throw new HttpError(400, "No pots eliminar el teu propi usuari");
  if (new URL(req.url).searchParams.get("confirm") !== "ELIMINA") throw new HttpError(400, "Cal confirmar l'eliminació (operació sensible)");
  const r = await adminClient().auth.admin.deleteUser(id);
  if (r.error) throw new HttpError(400, r.error.message);
  await secLog(me, "baixa_usuari", "profiles", id, null);
  return { ok: true };
});
