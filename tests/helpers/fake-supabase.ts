/**
 * Client Supabase EN MEMÒRIA per provar el motor del servidor (només proves).
 * Implementa el subconjunt del constructor de consultes que fa servir el codi: select/insert/upsert/update/delete,
 * filtres eq/neq/in/is/not/gte/gt/lte/lt/like/ilike, order/range/limit/single/maybeSingle, count/head i rpc.
 * Les relacions incrustades (p. ex. «crm_clients(name)») es resolen per clau forana `<taula>_id` → `id` o, si la fila
 * ja porta l'objecte, es manté. Les restriccions úniques es declaren a `UNIQUE`.
 */
type Row = Record<string, unknown>;
type Err = { code: string; message: string } | null;

const UNIQUE: Record<string, string[][]> = {
  ai_opportunities: [["dedupe_key"]],
  crm_tasks: [["rule_key"]],
  crm_notifications: [["user_id", "rule_key"]],
  ai_recommendations: [["opportunity_id", "input_hash"]],
  ai_automation_logs: [["idempotency_key"]],
  tariff_snapshots: [["sha256"]],
  ai_opportunity_economics: [["opportunity_id", "layer"]],
  crm_automation_rules: [["key"]],
  cap_submissions: [["idempotency_key"]],
  cap_webhook_events: [["provider", "external_id"]],
  cap_conversion_events: [["lead_id", "kind"]],
  cap_visits: [["session_hash", "event"]],
  cap_referral_links: [["code"]],
  cap_attributions: [["lead_id", "partner_id"]],
  cap_campaign_costs: [["campaign_id", "day", "source"]],
  cap_invoice_readings: [["document_id"]],
  fin_collaborator_terms: [["user_id"]],
  user_dashboard_prefs: [["user_id"]],
  role_permissions: [["role", "module"]],
  user_permissions: [["user_id", "module"]],
  dq_reviews: [["signature"]],
  sec_settings: [["key"]],
  report_runs: [["kind", "period_key", "recipient_id"]],
  renewal_group_ops: [["id"]],
  activities: [["id"]],
};
/** Relacions especials: «taula.relació» → clau forana a la fila (una) o a la relació (moltes, invers). */
const FK_BY_TABLE: Record<string, string> = { "crm_leads.cap_partners": "capture_partner_id", "cap_referral_links.cap_partners": "partner_id", "cap_attributions.cap_partners": "partner_id", "cap_attributions.crm_leads": "lead_id", "cap_invoice_readings.crm_leads": "lead_id" };
const REVERSE: Record<string, string> = { "cap_submissions.cap_lead_documents": "submission_id", "cap_lead_documents.cap_invoice_readings": "document_id" };
const FK: Record<string, string> = { crm_clients: "client_id", crm_supplies: "supply_id", crm_contracts: "contract_id", crm_expedient_terms: "accepted_terms_id" };
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

export function fakeSupabase(seed: Record<string, Row[]> = {}, rpcs: Record<string, (args: unknown) => unknown> = {}) {
  const db: Record<string, Row[]> = {};
  // columna generada de Postgres: crm_supplies.cups20 = left(cups, 20)
  const generated = (t: string, r: Row): Row => (t === "crm_supplies" && typeof r.cups === "string" ? { ...r, cups20: (r.cups as string).slice(0, 20) } : r);
  for (const [t, rows] of Object.entries(seed)) db[t] = rows.map((r) => generated(t, { ...r }));
  const table = (t: string) => (db[t] ??= []);

  function embed(t: string, r: Row, cols: string): Row {
    const out: Row = { ...r };
    for (const m of cols.matchAll(/(\w+)(?:!\w+)?\(([^()]*)\)/g)) {
      const rel = m[1];
      if (out[rel] !== undefined) continue;
      if (REVERSE[`${t}.${rel}`]) { out[rel] = table(rel).filter((x) => x[REVERSE[`${t}.${rel}`]] === r.id); continue; }
      const fk = FK_BY_TABLE[`${t}.${rel}`] ?? FK[rel] ?? `${rel.replace(/^crm_/, "").replace(/s$/, "")}_id`;
      const id = r[fk] ?? (rel === "crm_clients" && t === "crm_clients" ? r.id : undefined);
      out[rel] = id ? (table(rel).find((x) => x.id === id) ?? null) : null;
    }
    // camins JSON «snapshot->current»
    for (const m of cols.matchAll(/(\w+)->(\w+)/g)) out[m[2]] = (r[m[1]] as Row | undefined)?.[m[2]] ?? null;
    return out;
  }
  const like = (v: unknown, pat: string, ci: boolean) => new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, ci ? "i" : "").test(String(v ?? ""));
  const parseList = (s: string) => s.replace(/^\(|\)$/g, "").split(",").map((x) => x.trim());

  function builder(t: string) {
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let cols = "*";
    let payload: Row[] = [];
    let patch: Row = {};
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let returning = false;
    let countMode = false, head = false;
    const filters: ((r: Row) => boolean)[] = [];
    const orders: [string, boolean][] = [];
    let from = 0, to = Infinity;
    let single: "one" | "maybe" | null = null;

    const q = {
      select(c = "*", o?: { count?: string; head?: boolean }) { if (op === "select") cols = c; else returning = true; cols = c; countMode = !!o?.count; head = !!o?.head; return q; },
      insert(rows: Row | Row[]) { op = "insert"; payload = Array.isArray(rows) ? rows : [rows]; return q; },
      upsert(rows: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { op = "upsert"; payload = Array.isArray(rows) ? rows : [rows]; upsertOpts = o; return q; },
      update(p: Row) { op = "update"; patch = p; return q; },
      delete() { op = "delete"; return q; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
      neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return q; },
      in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return q; },
      is(c: string, v: null) { filters.push((r) => (r[c] ?? null) === v); return q; },
      not(c: string, o: string, v: unknown) {
        if (o === "is") filters.push((r) => (r[c] ?? null) !== v);
        else if (o === "in") { const l = parseList(String(v)); filters.push((r) => !l.includes(String(r[c]))); }
        return q;
      },
      gte(c: string, v: unknown) { filters.push((r) => r[c] != null && String(r[c]) >= String(v)); return q; },
      gt(c: string, v: unknown) { filters.push((r) => r[c] != null && Number(r[c]) > Number(v)); return q; },
      lte(c: string, v: unknown) { filters.push((r) => r[c] != null && String(r[c]) <= String(v)); return q; },
      lt(c: string, v: unknown) { filters.push((r) => r[c] != null && String(r[c]) < String(v)); return q; },
      like(c: string, p: string) { filters.push((r) => like(r[c], p, false)); return q; },
      ilike(c: string, p: string) { filters.push((r) => like(r[c], p, true)); return q; },
      contains(c: string, vs: unknown[]) { filters.push((r) => Array.isArray(r[c]) && vs.every((v) => (r[c] as unknown[]).includes(v))); return q; },
      or() { return q; },
      order(c: string, o?: { ascending?: boolean }) { orders.push([c, o?.ascending !== false]); return q; },
      range(a: number, b: number) { from = a; to = b; return q; },
      limit(n: number) { to = from + n - 1; return q; },
      single() { single = "one"; return q; },
      maybeSingle() { single = "maybe"; return q; },
      then<T>(res: (v: { data: unknown; error: Err; count?: number | null }) => T, rej?: (e: unknown) => T) { return Promise.resolve().then(run).then(res, rej); },
    };

    function conflictKeyFor(r: Row): ((x: Row) => boolean) | null {
      const sets = upsertOpts.onConflict ? [upsertOpts.onConflict.split(",").map((s) => s.trim())] : UNIQUE[t] ?? [];
      for (const keys of sets) if (keys.every((k) => r[k] != null)) return (x: Row) => keys.every((k) => x[k] === r[k]);
      return null;
    }
    function uniqueViolation(r: Row, exceptId?: unknown): boolean {
      if (t === "ai_analysis_runs" && r.status === "en_curs" && table(t).some((x) => x.status === "en_curs" && x.id !== exceptId)) return true;
      if (t === "cap_attributions" && r.status === "vigent" && table(t).some((x) => x.status === "vigent" && x.lead_id === r.lead_id && x.id !== exceptId)) return true;
      return (UNIQUE[t] ?? []).some((keys) => keys.every((k) => r[k] != null) && table(t).some((x) => x.id !== exceptId && keys.every((k) => x[k] === r[k])));
    }
    const defaults = (r: Row): Row => {
      const now = new Date().toISOString();
      const base: Row = { id: r.id ?? (t === "crm_automation_runs" || t === "ai_messages" || t === "ai_usage" || t === "opportunity_scores" ? ++seq : uuid()), created_at: now, updated_at: now };
      if (t === "ai_analysis_runs") Object.assign(base, { status: "en_curs", attempts: 1, started_at: now, stats: {}, errors: [] });
      if (t === "ai_opportunities") Object.assign(base, { status: "nova", detected_at: now, last_seen_at: now, evidence: [], score_factors: [] });
      if (t === "crm_tasks") Object.assign(base, { status: "pendent" });
      if (t === "cap_submissions") Object.assign(base, { status: "rebuda", attempts: 0, received_at: now, spam_reasons: [] });
      if (t === "cap_attributions") Object.assign(base, { status: "vigent" });
      if (t === "crm_leads") Object.assign(base, { status: "nou", duplicate_status: "unic", duplicate_refs: [], services: [] });
      if (t === "cap_invoice_readings") Object.assign(base, { status: "pendent", attempts: 0, fields: [], warnings: [], missing: [] });
      if (t === "cap_lead_documents") Object.assign(base, { status: "rebut" });
      if (t === "cap_referral_links") Object.assign(base, { active: true, channel: "recomanacio" });
      return { ...base, ...r };
    };

    function run(): { data: unknown; error: Err; count?: number | null } {
      const rows = table(t);
      const match = (r: Row) => filters.every((f) => f(r));
      let out: Row[] = [];
      if (op === "select") out = rows.filter(match);
      else if (op === "insert") {
        for (const r of payload) {
          const n = generated(t, defaults(r));
          if (uniqueViolation(n)) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${t}` } };
          rows.push(n); out.push(n);
        }
      } else if (op === "upsert") {
        for (const r of payload) {
          const same = conflictKeyFor(r);
          const ex = same ? rows.find(same) : undefined;
          if (ex) { if (!upsertOpts.ignoreDuplicates) { Object.assign(ex, r, { updated_at: new Date().toISOString() }); out.push(ex); } }
          else { const n = defaults(r); rows.push(n); out.push(n); }
        }
      } else if (op === "update") {
        for (const r of rows.filter(match)) {
          const next = { ...r, ...patch };
          if (uniqueViolation(next, r.id)) return { data: null, error: { code: "23505", message: "duplicate key" } };
          Object.assign(r, patch); out.push(r);
        }
      } else if (op === "delete") { const keep = rows.filter((r) => !match(r)); out = rows.filter(match); db[t] = keep; }
      if (op === "select" || returning || single) {
        for (const [c, asc] of orders.slice().reverse()) out = [...out].sort((a, b) => (a[c] === b[c] ? 0 : (a[c] ?? "") > (b[c] ?? "") ? (asc ? 1 : -1) : asc ? -1 : 1));
        const total = out.length;
        out = out.slice(from, to === Infinity ? undefined : to + 1).map((r) => embed(t, r, cols));
        if (head) return { data: null, error: null, count: total };
        if (single === "one") return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: "PGRST116", message: "not single" } };
        if (single === "maybe") return { data: out[0] ?? null, error: null };
        return { data: out, error: null, count: countMode ? total : null };
      }
      return { data: null, error: null };
    }
    return q;
  }
  const files = new Map<string, { bytes: Uint8Array<ArrayBuffer>; type: string }>();
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, o?: { contentType?: string; upsert?: boolean }) => {
        const k = `${bucket}/${path}`;
        if (files.has(k) && !o?.upsert) return { data: null, error: { message: "exists" } };
        files.set(k, { bytes: new Uint8Array(new Uint8Array(bytes).buffer.slice(0)) as Uint8Array<ArrayBuffer>, type: o?.contentType ?? "application/octet-stream" });
        return { data: { path }, error: null };
      },
      download: async (path: string) => { const f = files.get(`${bucket}/${path}`); return f ? { data: new Blob([f.bytes], { type: f.type }), error: null } : { data: null, error: { message: "not found" } }; },
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://example/${bucket}/${path}?token=t` }, error: null }),
      remove: async (paths: string[]) => { for (const p of paths) files.delete(`${bucket}/${p}`); return { data: null, error: null }; },
    }),
  };
  const client = { from: (t: string) => builder(t), rpc: async (name: string, args: unknown) => ({ data: rpcs[name] ? rpcs[name](args) : null, error: null }), storage, db, files,
    auth: { admin: { inviteUserByEmail: async (email: string) => { if (table("auth_users").some((u) => u.email === email)) return { data: { user: null }, error: { message: "User already registered" } }; const id = uuid(); table("auth_users").push({ id, email }); return { data: { user: { id, email } }, error: null }; },
      // Simula generateLink: no envia cap correu, només crea l'usuari (invite) i retorna un codi d'un sol ús.
      generateLink: async ({ type, email }: { type: string; email: string }) => {
        let u = table("auth_users").find((x) => x.email === email) as { id: string; email: string } | undefined;
        if (type === "invite") { if (u) return { data: { user: null, properties: null }, error: { message: "A user with this email address has already been registered" } }; u = { id: uuid(), email }; table("auth_users").push(u); }
        if (!u) return { data: { user: null, properties: null }, error: { message: "User not found" } };
        return { data: { user: u, properties: { hashed_token: `hash_${type}_${u.id.replace(/-/g, "")}` } }, error: null };
      } } } };
  return client;
}
