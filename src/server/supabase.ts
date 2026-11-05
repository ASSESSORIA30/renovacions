import "server-only";
import { ZodError } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { env, supabaseEnvProblem } from "./env";

/** Supabase client acting AS THE LOGGED-IN USER (RLS applies). */
export async function userClient() {
  const problem = supabaseEnvProblem();
  if (problem) throw new HttpError(503, problem);
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* called from a Server Component */ } },
    },
  });
}

/** Service-role client: bypasses RLS. Only for the sync job. Never expose to the browser. */
export function adminClient() {
  const problem = supabaseEnvProblem();
  if (problem) throw new HttpError(503, problem);
  if (!env.supabaseService) throw new HttpError(503, "Falta SUPABASE_SERVICE_ROLE_KEY al servidor (Vercel → Environment Variables).");
  return createClient(env.supabaseUrl, env.supabaseService, { auth: { persistSession: false } });
}

export { HttpError } from "./http-error";
import { HttpError } from "./http-error";

export async function requireUser(opts: { admin?: boolean; staff?: boolean } = {}) {
  const sb = await userClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new HttpError(401, "No has iniciat sessió");
  const { data: profile } = await sb.from("profiles").select("*").eq("id", data.user.id).single();
  if (!profile) throw new HttpError(403, "Usuari sense perfil");
  if (opts.admin && profile.role !== "admin") throw new HttpError(403, "Només per a administradors");
  if (opts.staff && !["admin", "cap_administrativa", "administrativa"].includes(profile.role)) throw new HttpError(403, "Només per a l'equip d'administració");
  return { sb, user: data.user, profile: profile as { id: string; name: string; email: string; role: import("@/core/types").Role; code: string | null } };
}

/** Wrap a route handler: JSON errors, no stack traces leaked. */
export function handler<T>(fn: (req: Request) => Promise<T>) {
  return async (req: Request) => {
    try {
      return Response.json(await fn(req));
    } catch (e) {
      // Fase 8.1: dades d'entrada no vàlides → 400 entenedor (abans sortia com a error 500)
      if (e instanceof ZodError) return Response.json({ error: `Dades no vàlides: ${e.issues.slice(0, 3).map((i) => `${i.path.join(".") || "petició"} (${i.message})`).join("; ")}` }, { status: 400 });
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return Response.json({ error: e instanceof Error ? e.message : "Error" }, { status });
    }
  };
}
