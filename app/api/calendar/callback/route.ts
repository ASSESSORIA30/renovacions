import { completeConnection, readState, syncConnection, type Conn } from "@/server/calendar";
import { adminClient, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Retorn d'OAuth (Google / Microsoft). Valida l'usuari, el «state» signat i la galeta; desa la connexió i torna a l'Agenda. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (ok: boolean, msg: string) => {
    const to = new URL("/", url.origin);
    to.searchParams.set("v", "agenda");
    to.searchParams.set("calendar", ok ? "ok" : "error");
    to.searchParams.set("msg", msg.slice(0, 200));
    return new Response(null, { status: 302, headers: { Location: to.toString(), "Set-Cookie": "a30_cal_state=; Path=/api/calendar; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });
  };
  try {
    const u = await requireInternal();
    if (url.searchParams.get("error")) return back(false, url.searchParams.get("error_description") || "Has cancel·lat l'autorització del calendari.");
    const cookie = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith("a30_cal_state="))?.slice("a30_cal_state=".length) ?? null;
    const s = readState(url.searchParams.get("state") ?? "", cookie, u.user.id);
    const code = url.searchParams.get("code");
    if (!code) throw new HttpError(400, "Falta el codi d'autorització");
    const r = await completeConnection(u.user.id, s.p, s.m, code);
    // primera sincronització (no bloqueja si falla: es veurà l'error a l'Agenda)
    const c = (await adminClient().from("calendar_connections").select("*").eq("id", r.id).maybeSingle()).data as Conn | null;
    if (c) await syncConnection(c).catch(() => undefined);
    return back(true, `${s.p === "google" ? "Google Calendar" : "Outlook"} connectat${r.email ? ` (${r.email})` : ""}`);
  } catch (e) {
    return back(false, e instanceof HttpError ? e.message : "No s'ha pogut completar la connexió del calendari.");
  }
}
