import "server-only";
/**
 * CALENDARIS EXTERNS (Fase 10) · Google Calendar i Microsoft Outlook (Microsoft Graph).
 *
 *  - OAuth 2.0 amb «state» signat (cookie httpOnly) i secrets només al servidor. Els tokens es desen XIFRATS
 *    (AES-256-GCM, mateixa clau que els altres secrets) a calendar_connections, taula sense cap política de
 *    lectura per als usuaris: mai arriben al navegador.
 *  - Modes (els tria l'usuari): «lectura» (només s'importen les cites externes), «exportacio» (s'envien les cites
 *    del CRM) i «bidireccional» (totes dues; només si l'usuari ho autoritza expressament).
 *  - Duplicats: índex únic (propietari, proveïdor, id extern) per a les importades i calendar_event_links per a
 *    les exportades; les cites exportades no es tornen a importar.
 *  - Conflictes (canviada als dos costats des de l'última sincronització): guanya el CRM i queda anotat.
 *  - Zona horària: es treballa en UTC i es declara Europe/Madrid perquè les recurrències mantinguin l'hora local.
 *  - Sense credencials OAuth configurades, res es mostra com a connectat.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { TZ, type Recurrence } from "@/core/agenda";
import { keyMaterial } from "./mailer";
import { open, seal } from "./secret-box";
import { adminClient, HttpError } from "./supabase";
import type { U } from "./crm";

type F = typeof fetch;
export type Provider = "google" | "microsoft";
export type Mode = "lectura" | "exportacio" | "bidireccional";
const PURPOSE = "calendar-oauth-token";
const WINDOW_PAST_DAYS = 30, WINDOW_FUTURE_DAYS = 180;

/* ======================================================================= configuració */

export function calendarConfig() {
  const g = { id: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "", secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "" };
  const m = { id: process.env.MICROSOFT_CALENDAR_CLIENT_ID ?? "", secret: process.env.MICROSOFT_CALENDAR_CLIENT_SECRET ?? "", tenant: process.env.MICROSOFT_CALENDAR_TENANT || "common" };
  const app = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")).replace(/\/$/, "");
  const miss = (pairs: [string, string][]) => pairs.filter(([, v]) => !v).map(([k]) => k);
  const gMissing = miss([["GOOGLE_CALENDAR_CLIENT_ID", g.id], ["GOOGLE_CALENDAR_CLIENT_SECRET", g.secret], ["APP_URL", app]]);
  const mMissing = miss([["MICROSOFT_CALENDAR_CLIENT_ID", m.id], ["MICROSOFT_CALENDAR_CLIENT_SECRET", m.secret], ["APP_URL", app]]);
  return {
    app, redirect: (p: Provider) => `${app}/api/calendar/callback?provider=${p}`,
    google: { ...g, ready: !gMissing.length, missing: gMissing },
    microsoft: { ...m, ready: !mMissing.length, missing: mMissing },
  };
}

const SCOPES: Record<Provider, (mode: Mode) => string> = {
  google: (mode) => ["openid", "email", mode === "lectura" ? "https://www.googleapis.com/auth/calendar.readonly" : "https://www.googleapis.com/auth/calendar.events"].join(" "),
  microsoft: (mode) => ["openid", "email", "offline_access", "User.Read", mode === "lectura" ? "Calendars.Read" : "Calendars.ReadWrite"].join(" "),
};

/* ======================================================================= state OAuth signat */

const sign = (v: string) => createHmac("sha256", keyMaterial()).update(`calendar-state:${v}`).digest("base64url");
export function makeState(userId: string, provider: Provider, mode: Mode) {
  const payload = Buffer.from(JSON.stringify({ u: userId, p: provider, m: mode, n: randomBytes(16).toString("base64url"), t: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function readState(state: string, cookie: string | null | undefined, userId: string) {
  const [payload, mac] = (state ?? "").split(".");
  if (!payload || !mac || !cookie || cookie !== state) throw new HttpError(400, "La sol·licitud de connexió no és vàlida o ha caducat. Torna-ho a provar des de l'Agenda.");
  const a = Buffer.from(mac), b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(400, "Signatura de la connexió no vàlida");
  const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; p: Provider; m: Mode; t: number };
  if (s.u !== userId) throw new HttpError(403, "Aquesta connexió és d'un altre usuari");
  if (Date.now() - s.t > 15 * 60000) throw new HttpError(400, "La connexió ha caducat (15 minuts). Torna-ho a provar.");
  return s;
}

export function authUrl(provider: Provider, mode: Mode, state: string) {
  const c = calendarConfig();
  if (provider === "google") {
    if (!c.google.ready) throw new HttpError(503, `Google Calendar no està configurat. Falten: ${c.google.missing.join(", ")}`);
    const q = new URLSearchParams({ client_id: c.google.id, redirect_uri: c.redirect("google"), response_type: "code", scope: SCOPES.google(mode), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  if (!c.microsoft.ready) throw new HttpError(503, `Outlook no està configurat. Falten: ${c.microsoft.missing.join(", ")}`);
  const q = new URLSearchParams({ client_id: c.microsoft.id, redirect_uri: c.redirect("microsoft"), response_type: "code", response_mode: "query", scope: SCOPES.microsoft(mode), state, prompt: "select_account" });
  return `https://login.microsoftonline.com/${encodeURIComponent(c.microsoft.tenant)}/oauth2/v2.0/authorize?${q}`;
}

/* ======================================================================= tokens */

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string };
async function tokenRequest(provider: Provider, params: Record<string, string>, f: F): Promise<Tokens> {
  const c = calendarConfig();
  const url = provider === "google" ? "https://oauth2.googleapis.com/token" : `https://login.microsoftonline.com/${encodeURIComponent(c.microsoft.tenant)}/oauth2/v2.0/token`;
  const cred: Record<string, string> = provider === "google" ? { client_id: c.google.id, client_secret: c.google.secret } : { client_id: c.microsoft.id, client_secret: c.microsoft.secret };
  const r = await f(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...cred, ...params }) });
  const j = (await r.json().catch(() => ({}))) as Tokens & { error?: string; error_description?: string };
  if (!r.ok || !j.access_token) {
    const revoked = j.error === "invalid_grant" || j.error === "interaction_required";
    throw new HttpError(revoked ? 401 : 502, revoked ? "L'autorització del calendari ha caducat o s'ha revocat: cal tornar a connectar-lo." : `El proveïdor ha rebutjat l'autorització (${j.error ?? r.status}).`);
  }
  return j;
}

const enc = (v: string | undefined | null) => (v ? seal(v, keyMaterial(), PURPOSE) : null);
const dec = (v: string | null | undefined) => (v ? open(v, keyMaterial(), PURPOSE) : null);

export type Conn = { id: string; user_id: string; provider: Provider; account_email: string | null; mode: Mode; status: string; access_token_enc: string | null; refresh_token_enc: string | null; token_expires_at: string | null; calendar_id: string; last_sync_at: string | null; last_error: string | null };

/** Intercanvia el codi d'autorització i desa la connexió (tokens xifrats). */
export async function completeConnection(userId: string, provider: Provider, mode: Mode, code: string, f: F = fetch) {
  const c = calendarConfig();
  const t = await tokenRequest(provider, { grant_type: "authorization_code", code, redirect_uri: c.redirect(provider) }, f);
  let email: string | null = null;
  try {
    if (provider === "google") {
      const r = await f("https://www.googleapis.com/calendar/v3/calendars/primary", { headers: { Authorization: `Bearer ${t.access_token}` } });
      email = ((await r.json()) as { id?: string }).id ?? null;
    } else {
      const r = await f("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${t.access_token}` } });
      const j = (await r.json()) as { mail?: string; userPrincipalName?: string };
      email = j.mail ?? j.userPrincipalName ?? null;
    }
  } catch { /* el correu és informatiu */ }
  const row = {
    user_id: userId, provider, mode, status: "connectat", account_email: email, access_token_enc: enc(t.access_token), refresh_token_enc: enc(t.refresh_token),
    token_expires_at: new Date(Date.now() + Math.max(60, (t.expires_in ?? 3600) - 60) * 1000).toISOString(), scope: t.scope ?? null, last_error: null, updated_at: new Date().toISOString(),
  };
  const r = await adminClient().from("calendar_connections").upsert(row, { onConflict: "user_id,provider" }).select("id").single();
  if (r.error) throw new HttpError(/does not exist|Could not find/i.test(r.error.message) ? 503 : 500, /does not exist|Could not find/i.test(r.error.message) ? "Falta aplicar la migració 020_agenda.sql" : "No s'ha pogut desar la connexió");
  return { id: r.data.id as string, email };
}

async function accessToken(c: Conn, f: F): Promise<string> {
  const cur = dec(c.access_token_enc);
  if (cur && c.token_expires_at && new Date(c.token_expires_at).getTime() > Date.now() + 60000) return cur;
  const rt = dec(c.refresh_token_enc);
  if (!rt) throw new HttpError(401, "No hi ha permís de renovació: cal tornar a connectar el calendari.");
  const t = await tokenRequest(c.provider, { grant_type: "refresh_token", refresh_token: rt }, f);
  await adminClient().from("calendar_connections").update({
    access_token_enc: enc(t.access_token), ...(t.refresh_token ? { refresh_token_enc: enc(t.refresh_token) } : {}),
    token_expires_at: new Date(Date.now() + Math.max(60, (t.expires_in ?? 3600) - 60) * 1000).toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", c.id);
  return t.access_token;
}

/* ======================================================================= conversió d'esdeveniments */

export type ExtEvent = { id: string; etag: string | null; updated: string | null; cancelled: boolean; title: string; description: string | null; location: string | null; start: string; end: string; allDay: boolean; fromCrm: string | null };
type CrmEvent = { id: string; title: string; description: string | null; location: string | null; starts_at: string; ends_at: string; all_day: boolean; scope: string; status: string; kind: string; recurrence: Recurrence | null; version: number };

const allDayIso = (d: string) => new Date(`${d}T00:00:00Z`).toISOString();
export function fromGoogle(e: Record<string, unknown>): ExtEvent {
  const s = (e.start ?? {}) as { dateTime?: string; date?: string }, en = (e.end ?? {}) as { dateTime?: string; date?: string };
  const priv = ((e.extendedProperties as { private?: Record<string, string> } | undefined)?.private ?? {}) as Record<string, string>;
  return {
    id: String(e.id), etag: (e.etag as string) ?? null, updated: (e.updated as string) ?? null, cancelled: e.status === "cancelled",
    title: String(e.summary ?? "(sense títol)").slice(0, 200), description: e.description ? String(e.description).slice(0, 5000) : null, location: e.location ? String(e.location).slice(0, 300) : null,
    start: s.dateTime ? new Date(s.dateTime).toISOString() : s.date ? allDayIso(s.date) : new Date(0).toISOString(),
    end: en.dateTime ? new Date(en.dateTime).toISOString() : en.date ? allDayIso(en.date) : new Date(0).toISOString(),
    allDay: !s.dateTime && !!s.date, fromCrm: priv.a30Id ?? null,
  };
}
export function fromMicrosoft(e: Record<string, unknown>): ExtEvent {
  const s = (e.start ?? {}) as { dateTime?: string; timeZone?: string }, en = (e.end ?? {}) as { dateTime?: string; timeZone?: string };
  const utc = (x?: string) => (x ? new Date(/Z|[+-]\d\d:\d\d$/.test(x) ? x : `${x}Z`).toISOString() : new Date(0).toISOString());
  const cats = (e.categories as string[] | undefined) ?? [];
  const tag = cats.find((c) => c.startsWith("a30:"));
  return {
    id: String(e.id), etag: (e["@odata.etag"] as string) ?? (e.changeKey as string) ?? null, updated: (e.lastModifiedDateTime as string) ?? null, cancelled: !!e.isCancelled,
    title: String(e.subject ?? "(sense títol)").slice(0, 200), description: e.bodyPreview ? String(e.bodyPreview).slice(0, 5000) : null,
    location: ((e.location as { displayName?: string } | undefined)?.displayName || null)?.slice(0, 300) ?? null,
    start: utc(s.dateTime), end: utc(en.dateTime), allDay: !!e.isAllDay, fromCrm: tag ? tag.slice(4) : null,
  };
}
const RRULE_FREQ = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" } as const;
export function toRRule(r: Recurrence) {
  const p = [`FREQ=${RRULE_FREQ[r.freq]}`];
  if (r.interval && r.interval > 1) p.push(`INTERVAL=${r.interval}`);
  if (r.freq === "weekly" && r.byweekday?.length) p.push(`BYDAY=${r.byweekday.map((d) => ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][d - 1]).join(",")}`);
  if (r.until) p.push(`UNTIL=${r.until.replace(/-/g, "")}T225959Z`);
  else if (r.count) p.push(`COUNT=${r.count}`);
  return `RRULE:${p.join(";")}`;
}
const tag = (e: CrmEvent) => `${e.scope === "compartida" ? "Agenda compartida" : "Agenda personal"} · Assessoria 3.0 CRM`;
export function toGoogle(e: CrmEvent) {
  const body: Record<string, unknown> = {
    summary: e.title, description: [e.description, `— ${tag(e)}`].filter(Boolean).join("\n\n"), location: e.location ?? undefined,
    start: e.all_day ? { date: e.starts_at.slice(0, 10) } : { dateTime: e.starts_at, timeZone: TZ },
    end: e.all_day ? { date: e.ends_at.slice(0, 10) } : { dateTime: e.ends_at, timeZone: TZ },
    visibility: e.scope === "personal" ? "private" : "default",
    status: e.status === "cancellada" ? "cancelled" : "confirmed",
    extendedProperties: { private: { a30Id: e.id, a30Scope: e.scope, a30Kind: e.kind } },
  };
  if (e.recurrence) body.recurrence = [toRRule(e.recurrence)];
  return body;
}
export function toMicrosoft(e: CrmEvent) {
  const dt = (iso: string) => ({ dateTime: iso.replace(/Z$/, "").slice(0, 19), timeZone: "UTC" });
  const body: Record<string, unknown> = {
    subject: e.title, body: { contentType: "text", content: [e.description, `— ${tag(e)}`].filter(Boolean).join("\n\n") },
    start: dt(e.starts_at), end: dt(e.ends_at), isAllDay: e.all_day, location: e.location ? { displayName: e.location } : undefined,
    sensitivity: e.scope === "personal" ? "private" : "normal", categories: [`a30:${e.id}`],
  };
  if (e.recurrence) {
    const wd = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const d = new Date(e.starts_at);
    body.recurrence = {
      pattern: { type: { daily: "daily", weekly: "weekly", monthly: "absoluteMonthly", yearly: "absoluteYearly" }[e.recurrence.freq], interval: e.recurrence.interval ?? 1,
        ...(e.recurrence.freq === "weekly" ? { daysOfWeek: (e.recurrence.byweekday?.length ? e.recurrence.byweekday : [((d.getUTCDay() + 6) % 7) + 1]).map((x) => wd[x - 1]) } : {}),
        ...(e.recurrence.freq === "monthly" || e.recurrence.freq === "yearly" ? { dayOfMonth: d.getUTCDate() } : {}), ...(e.recurrence.freq === "yearly" ? { month: d.getUTCMonth() + 1 } : {}) },
      range: e.recurrence.until ? { type: "endDate", startDate: e.starts_at.slice(0, 10), endDate: e.recurrence.until } : e.recurrence.count ? { type: "numbered", startDate: e.starts_at.slice(0, 10), numberOfOccurrences: e.recurrence.count } : { type: "noEnd", startDate: e.starts_at.slice(0, 10) },
    };
  }
  return body;
}

/* ======================================================================= API dels proveïdors */

async function api(f: F, token: string, url: string, init: RequestInit = {}) {
  const r = await f(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (r.status === 401) throw new HttpError(401, "El proveïdor ha rebutjat el token: cal tornar a connectar el calendari.");
  if (r.status === 404 || r.status === 410) return { status: r.status, json: null as Record<string, unknown> | null };
  if (r.status === 429) throw new HttpError(429, "El proveïdor limita les peticions: es tornarà a provar a la propera sincronització.");
  if (!r.ok) throw new HttpError(502, `El proveïdor ha respost ${r.status}`);
  return { status: r.status, json: r.status === 204 ? null : ((await r.json().catch(() => null)) as Record<string, unknown> | null) };
}

async function listExternal(c: Conn, token: string, f: F, from: string, to: string): Promise<ExtEvent[]> {
  const out: ExtEvent[] = [];
  if (c.provider === "google") {
    let next: string | undefined;
    for (let i = 0; i < 20; i++) {
      const q = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: "true", showDeleted: "true", maxResults: "2500", ...(next ? { pageToken: next } : {}) });
      const r = await api(f, token, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.calendar_id)}/events?${q}`);
      const items = ((r.json?.items as Record<string, unknown>[]) ?? []);
      out.push(...items.map(fromGoogle));
      next = r.json?.nextPageToken as string | undefined;
      if (!next) break;
    }
  } else {
    let url: string | undefined = `https://graph.microsoft.com/v1.0/me/calendarView?${new URLSearchParams({ startDateTime: from, endDateTime: to, $top: "500" })}`;
    for (let i = 0; i < 20 && url; i++) {
      const r = await api(f, token, url, { headers: { Prefer: 'outlook.timezone="UTC"' } });
      out.push(...(((r.json?.value as Record<string, unknown>[]) ?? []).map(fromMicrosoft)));
      url = r.json?.["@odata.nextLink"] as string | undefined;
    }
  }
  return out;
}

/* ======================================================================= sincronització */

export type SyncResult = { provider: Provider; imported: number; updated: number; removed: number; pushed: number; conflicts: number; errors: string[] };

/** Sincronitza una connexió segons el seu mode. `f` es pot substituir als tests (simulació). */
export async function syncConnection(c: Conn, f: F = fetch, nowIso = new Date().toISOString()): Promise<SyncResult> {
  const sb = adminClient();
  const res: SyncResult = { provider: c.provider, imported: 0, updated: 0, removed: 0, pushed: 0, conflicts: 0, errors: [] };
  const now = new Date(nowIso);
  const from = new Date(now.getTime() - WINDOW_PAST_DAYS * 86400000).toISOString(), to = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 86400000).toISOString();
  try {
    const token = await accessToken(c, f);
    const links = (((await sb.from("calendar_event_links").select("event_id,external_id,external_etag,pushed_version").eq("connection_id", c.id)).data ?? []) as { event_id: string; external_id: string; external_etag: string | null; pushed_version: number | null }[]);
    const byExt = new Map(links.map((l) => [l.external_id, l]));

    // 1) importar (lectura o bidireccional)
    if (c.mode !== "exportacio") {
      const ext = await listExternal(c, token, f, from, to);
      const seen = new Set<string>();
      for (const e of ext) {
        seen.add(e.id);
        const link = byExt.get(e.id);
        if (link || e.fromCrm) {
          // cita que ve del CRM: en bidireccional s'apliquen els canvis externs si el CRM no l'ha tocada
          if (c.mode === "bidireccional" && link && e.etag && e.etag !== link.external_etag) {
            const ev = (await sb.from("agenda_events").select("id,version").eq("id", link.event_id).maybeSingle()).data as { id: string; version: number } | null;
            if (!ev) continue;
            if (ev.version !== link.pushed_version) { res.conflicts++; continue; } // canviada als dos costats: guanya el CRM (s'enviarà al pas 2)
            if (e.cancelled) { await sb.from("agenda_events").update({ status: "cancellada" }).eq("id", ev.id); }
            else await sb.from("agenda_events").update({ title: e.title, starts_at: e.start, ends_at: e.end < e.start ? e.start : e.end, all_day: e.allDay, location: e.location }).eq("id", ev.id);
            const nv = (await sb.from("agenda_events").select("version").eq("id", ev.id).maybeSingle()).data as { version: number } | null;
            await sb.from("calendar_event_links").update({ external_etag: e.etag, pushed_version: nv?.version ?? ev.version }).eq("connection_id", c.id).eq("event_id", ev.id);
            res.updated++;
          }
          continue;
        }
        if (e.cancelled) {
          const d = await sb.from("agenda_events").delete().eq("owner_id", c.user_id).eq("external_source", c.provider).eq("external_id", e.id).select("id");
          res.removed += d.data?.length ?? 0;
          continue;
        }
        const row = {
          owner_id: c.user_id, created_by: c.user_id, created_by_name: c.provider === "google" ? "Google Calendar" : "Outlook", title: e.title, description: e.description, location: e.location,
          kind: "cita", scope: "personal", starts_at: e.start, ends_at: e.end < e.start ? e.start : e.end, all_day: e.allDay, reminders: [] as number[],
          external_source: c.provider, external_id: e.id, external_etag: e.etag, external_updated_at: e.updated,
        };
        const ex = (await sb.from("agenda_events").select("id,external_etag").eq("owner_id", c.user_id).eq("external_source", c.provider).eq("external_id", e.id).maybeSingle()).data as { id: string; external_etag: string | null } | null;
        if (!ex) { const i = await sb.from("agenda_events").insert(row); if (i.error) res.errors.push(i.error.message.slice(0, 120)); else res.imported++; }
        else if (ex.external_etag !== e.etag) { await sb.from("agenda_events").update(row).eq("id", ex.id); res.updated++; }
      }
      // les importades que ja no hi són al proveïdor (esborrades) desapareixen de l'agenda
      const local = ((await sb.from("agenda_events").select("id,external_id").eq("owner_id", c.user_id).eq("external_source", c.provider).gte("starts_at", from).lt("starts_at", to)).data ?? []) as { id: string; external_id: string }[];
      const gone = local.filter((l) => !seen.has(l.external_id)).map((l) => l.id);
      if (gone.length) { await sb.from("agenda_events").delete().in("id", gone); res.removed += gone.length; }
    }

    // 2) exportar (exportacio o bidireccional): cites pròpies del CRM, no importades
    if (c.mode !== "lectura") {
      const evs = ((await sb.from("agenda_events").select("id,title,description,location,starts_at,ends_at,all_day,scope,status,kind,recurrence,version").eq("owner_id", c.user_id).is("external_source", null).or(`ends_at.gte.${from},recurrence.not.is.null`).lt("starts_at", to).limit(1000)).data ?? []) as CrmEvent[];
      const linkByEvent = new Map(links.map((l) => [l.event_id, l]));
      for (const e of evs) {
        const l = linkByEvent.get(e.id);
        if (l && l.pushed_version === e.version) continue; // sense canvis
        const base = c.provider === "google" ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.calendar_id)}/events` : "https://graph.microsoft.com/v1.0/me/events";
        const body = JSON.stringify(c.provider === "google" ? toGoogle(e) : toMicrosoft(e));
        if (e.status === "cancellada") {
          if (l) { await api(f, token, `${base}/${encodeURIComponent(l.external_id)}`, { method: "DELETE" }); await sb.from("calendar_event_links").delete().eq("connection_id", c.id).eq("event_id", e.id); res.pushed++; }
          continue;
        }
        const r = l ? await api(f, token, `${base}/${encodeURIComponent(l.external_id)}`, { method: "PATCH", body }) : await api(f, token, base, { method: "POST", body });
        if (l && r.status === 404) { await sb.from("calendar_event_links").delete().eq("connection_id", c.id).eq("event_id", e.id); continue; } // esborrada fora: es tornarà a crear a la propera
        const x = r.json ?? {};
        const extId = String(x.id ?? l?.external_id ?? "");
        if (!extId) continue;
        await sb.from("calendar_event_links").upsert({ connection_id: c.id, event_id: e.id, external_id: extId, external_etag: (x.etag as string) ?? (x["@odata.etag"] as string) ?? null, pushed_version: e.version, last_pushed_at: new Date().toISOString() }, { onConflict: "connection_id,event_id" });
        res.pushed++;
      }
    }
    await sb.from("calendar_connections").update({ status: "connectat", last_sync_at: new Date().toISOString(), last_error: res.conflicts ? `${res.conflicts} conflicte(s): s'ha mantingut la versió del CRM` : null, updated_at: new Date().toISOString() }).eq("id", c.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : "Error de sincronització";
    res.errors.push(msg);
    await sb.from("calendar_connections").update({ status: e instanceof HttpError && e.status === 401 ? "error" : c.status, last_error: msg, updated_at: new Date().toISOString() }).eq("id", c.id);
  }
  return res;
}

/** Esborra al calendari extern les còpies d'una cita del CRM que s'elimina (abans que desaparegui el vincle). */
export async function removeRemoteCopies(eventId: string, f: F = fetch) {
  const sb = adminClient();
  const links = ((await sb.from("calendar_event_links").select("connection_id,external_id,calendar_connections(*)").eq("event_id", eventId)).data ?? []) as unknown as { connection_id: string; external_id: string; calendar_connections: Conn | Conn[] | null }[];
  for (const l of links) {
    const c = Array.isArray(l.calendar_connections) ? l.calendar_connections[0] : l.calendar_connections;
    if (!c || c.status !== "connectat" || c.mode === "lectura") continue;
    try {
      const token = await accessToken(c, f);
      const url = c.provider === "google" ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.calendar_id)}/events/${encodeURIComponent(l.external_id)}` : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(l.external_id)}`;
      await api(f, token, url, { method: "DELETE" });
    } catch { /* es reintentarà manualment; no bloqueja l'eliminació al CRM */ }
  }
}

export async function syncAllCalendars(f: F = fetch) {
  const sb = adminClient();
  const r = await sb.from("calendar_connections").select("*").eq("status", "connectat").limit(200);
  if (r.error) return { migrated: false, connections: 0 };
  const out: SyncResult[] = [];
  for (const c of (r.data ?? []) as Conn[]) out.push(await syncConnection(c, f));
  return { migrated: true, connections: out.length, results: out.map((x) => ({ ...x, errors: x.errors.length })) };
}

/* ======================================================================= accions de l'usuari */

export async function calendarStatus(u: U) {
  const c = calendarConfig();
  const r = await adminClient().from("calendar_connections").select("provider,account_email,mode,status,last_sync_at,last_error,updated_at").eq("user_id", u.user.id);
  return {
    migrated: !r.error,
    providers: { google: { configured: c.google.ready, missing: c.google.missing }, microsoft: { configured: c.microsoft.ready, missing: c.microsoft.missing } },
    redirectUris: c.app ? { google: c.redirect("google"), microsoft: c.redirect("microsoft") } : null,
    connections: (r.data ?? []) as { provider: Provider; account_email: string | null; mode: Mode; status: string; last_sync_at: string | null; last_error: string | null }[],
  };
}

const modeZ = z.enum(["lectura", "exportacio", "bidireccional"]);
export async function setMode(u: U, raw: unknown) {
  const b = z.object({ provider: z.enum(["google", "microsoft"]), mode: modeZ, confirm: z.boolean().default(false) }).parse(raw);
  if (b.mode === "bidireccional" && !b.confirm) throw new HttpError(400, "La sincronització bidireccional necessita la teva autorització expressa (marca la casella).");
  const cur = (await adminClient().from("calendar_connections").select("id,mode,scope").eq("user_id", u.user.id).eq("provider", b.provider).maybeSingle()).data as { id: string; mode: Mode; scope: string | null } | null;
  if (!cur) throw new HttpError(404, "Aquest calendari no està connectat");
  // passar de lectura a escriptura necessita un permís nou del proveïdor: cal tornar a connectar
  const writable = !!cur.scope && /calendar\.events|Calendars\.ReadWrite/i.test(cur.scope);
  if (b.mode !== "lectura" && !writable) return { ok: false, reconnect: true, message: "Per exportar cites cal tornar a autoritzar el calendari amb permís d'escriptura." };
  await adminClient().from("calendar_connections").update({ mode: b.mode, updated_at: new Date().toISOString() }).eq("id", cur.id);
  return { ok: true };
}

export async function disconnect(u: U, raw: unknown, f: F = fetch) {
  const b = z.object({ provider: z.enum(["google", "microsoft"]) }).parse(raw);
  const sb = adminClient();
  const c = (await sb.from("calendar_connections").select("*").eq("user_id", u.user.id).eq("provider", b.provider).maybeSingle()).data as Conn | null;
  if (!c) return { ok: true };
  if (c.provider === "google") {
    const t = dec(c.refresh_token_enc) ?? dec(c.access_token_enc);
    if (t) await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => undefined);
  }
  // les còpies importades es treuen de l'agenda; les cites del CRM es conserven
  await sb.from("agenda_events").delete().eq("owner_id", u.user.id).eq("external_source", b.provider);
  await sb.from("calendar_event_links").delete().eq("connection_id", c.id);
  await sb.from("calendar_connections").update({ status: "revocat", access_token_enc: null, refresh_token_enc: null, token_expires_at: null, sync_token: null, updated_at: new Date().toISOString() }).eq("id", c.id);
  return { ok: true };
}

export async function syncMine(u: U, raw: unknown) {
  const b = z.object({ provider: z.enum(["google", "microsoft"]).optional() }).parse(raw ?? {});
  let q = adminClient().from("calendar_connections").select("*").eq("user_id", u.user.id).eq("status", "connectat");
  if (b.provider) q = q.eq("provider", b.provider);
  const r = await q;
  if (r.error) throw new HttpError(503, "Falta aplicar la migració 020_agenda.sql");
  if (!r.data?.length) throw new HttpError(404, "No tens cap calendari connectat");
  const out: SyncResult[] = [];
  for (const c of r.data as Conn[]) out.push(await syncConnection(c));
  return { results: out };
}
