import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { checkPassword } from "@/core/password";
import { env } from "@/server/env";
import { adminClient, handler, HttpError, requireUser } from "@/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Seguretat del compte de l'usuari connectat.
 * POST { action: "password", current, next } → canvia la contrasenya després de REAUTENTICAR-LA amb la contrasenya actual.
 *  - La comprovació es fa amb un client temporal sense persistència: no toca la sessió del navegador ni el nivell MFA.
 *  - El canvi el fa Supabase Auth (bcrypt). La contrasenya no es desa ni es registra enlloc.
 */
const body = z.object({ action: z.literal("password"), current: z.string().min(1).max(200), next: z.string().min(1).max(200) });

export const POST = handler(async (req) => {
  const u = await requireUser();
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, "Petició no vàlida");
  const email = u.user.email;
  if (!email) throw new HttpError(400, "El teu usuari no té correu: demana a Direcció que et canviï la contrasenya.");
  const policy = checkPassword(b.data.next, { email, name: u.profile.name, current: b.data.current });
  if (!policy.ok) throw new HttpError(400, policy.errors.join(" "));

  // reautenticació: la contrasenya actual ha de ser correcta
  const tmp = createClient(env.supabaseUrl, env.supabaseAnon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const check = await tmp.auth.signInWithPassword({ email, password: b.data.current });
  if (check.error || check.data.user?.id !== u.user.id) {
    await logEvent(u.user.id, u.profile.name, false);
    throw new HttpError(400, "La contrasenya actual no és correcta.");
  }
  await tmp.auth.signOut({ scope: "local" }).catch(() => undefined); // només la sessió temporal

  const up = await adminClient().auth.admin.updateUserById(u.user.id, { password: b.data.next });
  if (up.error) {
    const msg = /weak|pwned|leaked/i.test(up.error.message) ? "Supabase rebutja aquesta contrasenya perquè és massa feble o ha aparegut en filtracions. Tria'n una altra." : "No s'ha pogut canviar la contrasenya. Torna-ho a provar.";
    throw new HttpError(400, msg);
  }
  await logEvent(u.user.id, u.profile.name, true);
  return { ok: true };
});

async function logEvent(userId: string, name: string, ok: boolean) {
  // registre d'auditoria sense cap dada de la contrasenya; si la taula no hi és, no bloqueja
  try { await adminClient().from("sec_audit").insert({ actor_id: userId, actor_name: name, action: ok ? "canvi_contrasenya" : "canvi_contrasenya_fallit", entity: "compte", entity_id: userId, detail: null }); } catch { /* ignore */ }
}
