import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Refreshes the Supabase session cookie on each request (official @supabase/ssr pattern) and keeps collaborators in their portal. */
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return res;
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await sb.auth.getUser();
  // Fase 7: els col·laboradors només tenen el portal. El CRM intern (/) els redirigeix a /collaboradors
  // (les APIs internes també els rebutgen al servidor: això només evita que vegin la interfície interna).
  if (data.user && req.nextUrl.pathname === "/") {
    const { data: p } = await sb.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
    if (p?.role === "colaborador") {
      const to = req.nextUrl.clone(); to.pathname = "/collaboradors"; to.search = "";
      const r = NextResponse.redirect(to);
      res.cookies.getAll().forEach((c) => r.cookies.set(c));
      return r;
    }
  }
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/sync/cron|api/ai/cron|api/reports/cron|api/agenda/cron|api/signature/webhook|api/webhooks|api/capture/submit|api/capture/track).*)"] };
