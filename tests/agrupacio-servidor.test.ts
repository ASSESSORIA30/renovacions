/**
 * «CONTACTAR TOTS» i activitat conjunta · servei de servidor amb un Supabase simulat en memòria.
 * ATENCIÓ: l'SMTP i WhatsApp són SIMULATS (cap enviament real). Dades fictícies.
 * Escenaris: un, dos i diversos contractes, estats parcials, titulars diferents, errors SMTP/WhatsApp, permisos
 * insuficients, reintents (clics repetits), avís de duplicat, oposicions del client i històric compartit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase>; who: { id: string; role: string; name: string } | null; smtp: "ok" | "rebutja" | "error" | "off"; sent: { to: string; subject?: string; text?: string; attachments?: { filename: string }[] }[]; cloud: "ok" | "falla"; cloudSent: string[] } =
  { sb: fakeSupabase(), who: null, smtp: "ok", sent: [], cloud: "ok", cloudSent: [] };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  const handler = (fn: (r: Request) => Promise<unknown>) => async (r: Request) => {
    try { const x = await fn(r); return x instanceof Response ? x : Response.json(x); } catch (e) { return Response.json({ error: (e as Error).message }, { status: e instanceof HttpError ? e.status : (e as { name?: string }).name === "ZodError" ? 400 : 500 }); }
  };
  return { adminClient: () => state.sb, HttpError, handler };
});
vi.mock("@/server/permissions", async () => {
  const { HttpError } = await import("@/server/supabase");
  return {
    secLog: async () => undefined,
    requireInternal: async () => {
      if (!state.who) throw new HttpError(401, "No has iniciat sessió");
      if (state.who.role === "colaborador") throw new HttpError(403, "Només per a l'equip intern");
      return { sb: state.sb, user: { id: state.who.id }, profile: { id: state.who.id, name: state.who.name, role: state.who.role, email: "comercial@exemple.cat" } };
    },
  };
});
vi.mock("@/server/mailer", () => ({
  smtpReady: async () => state.smtp !== "off",
  sendCorporateMail: async (m: { to: string; subject: string; text: string; attachments: { filename: string }[] }) => {
    if (state.smtp === "error") throw Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" });
    state.sent.push(m);
    return { messageId: `<m${state.sent.length}@prova>`, accepted: state.smtp === "ok" ? [m.to] : [] };
  },
}));
vi.mock("@/server/comms", () => ({
  sendFromMyMailbox: async () => ({ accepted: false, messageId: null, from: "x", error: "Sense correu propi" }),
  sendCloudText: async (_u: unknown, to: string) => { state.cloudSent.push(to); return state.cloud === "ok" ? `wamid.${state.cloudSent.length}` : null; },
}));

const C1 = "00000000-0000-0000-0000-0000000000c1";
const OP = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const contract = (id: string, o: Record<string, unknown> = {}) => ({ id, cups: `ES00210000000000${id.slice(-2)}AA`, comercial: "C1", removed_from_source: false, data: { id, cups: `ES00210000000000${id.slice(-2)}AA`, cliente: `Titular ${id}`, cif: "B11111111", telefono: "600112233", email: "joan.prova@exemple.cat", representante: "Joan Prova Ficticia", tipo: "luz", vencimiento: "2026-12-01", ...o } });

async function api(method: "GET" | "POST", payload?: unknown, qs = "") {
  const { GET, POST } = await import("../app/api/renewals/groups/route");
  const r = method === "GET" ? await GET(new Request(`http://x/api/renewals/groups${qs}`)) : await POST(new Request("http://x/api/renewals/groups", { method: "POST", body: JSON.stringify(payload) }));
  return { status: r.status, j: await r.json() };
}
const send = (data: Record<string, unknown>) => api("POST", { action: "send", data: { channel: "email", recipient: "joan.prova@exemple.cat", subject: "Renovació", body: "Bon dia", confirmed: true, ...data } });

beforeEach(() => {
  state.sb = fakeSupabase({ contracts: [contract("k01"), contract("k02"), contract("k03", { cif: "H22222222", cliente: "Comunitat Prova" })], crm_state: [], documents: [], activities: [], renewal_group_ops: [], renewal_contact_authorizations: [] });
  state.who = { id: C1, role: "comercial", name: "Comercial Prova" };
  state.smtp = "ok"; state.sent = []; state.cloud = "ok"; state.cloudSent = [];
});

describe("Contactar tots · enviament per correu", () => {
  it("un contracte: un sol correu, una operació i l'activitat al contracte (sense canviar l'estat del Kanban)", async () => {
    const r = await send({ opId: OP(1), contractIds: ["k01"] });
    expect(r.status).toBe(200);
    expect(r.j.status).toBe("enviat");
    expect(state.sent).toHaveLength(1);
    expect(state.sb.db.renewal_group_ops).toHaveLength(1);
    expect(state.sb.db.activities.map((a) => a.contract_id)).toEqual(["k01"]);
    expect(state.sb.db.activities[0]).toMatchObject({ type: "email", delivery: "enviado" });
    expect(state.sb.db.crm_state).toHaveLength(0); // no es marca res com a contactat ni renovat automàticament
  });
  it("dos i diversos contractes del mateix titular: un sol correu amb els PDF dels seleccionats", async () => {
    await state.sb.storage.from("documents").upload("k01/d1.pdf", new Uint8Array([37, 80, 68, 70]), { contentType: "application/pdf" });
    await state.sb.storage.from("documents").upload("k02/d2.pdf", new Uint8Array([37, 80, 68, 70]), { contentType: "application/pdf" });
    state.sb.db.documents.push({ id: "10000000-0000-4000-8000-000000000001", contract_id: "k01", version: 1, file_name: "Proposta_k01.pdf", storage_path: "k01/d1.pdf" }, { id: "10000000-0000-4000-8000-000000000002", contract_id: "k02", version: 1, file_name: "Proposta_k02.pdf", storage_path: "k02/d2.pdf" });
    const r = await send({ opId: OP(2), contractIds: ["k01", "k02"], attachDocIds: ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"] });
    expect(r.j.status).toBe("enviat");
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].attachments!.map((a) => a.filename)).toEqual(["Proposta_k01.pdf", "Proposta_k02.pdf"]);
    expect(state.sb.db.activities).toHaveLength(2);
    expect(new Set(state.sb.db.activities.map((a) => (a.meta as { groupOpId: string }).groupOpId))).toEqual(new Set([OP(2)]));
  });
  it("no adjunta documents d'un contracte no seleccionat", async () => {
    state.sb.db.documents.push({ id: "10000000-0000-4000-8000-000000000003", contract_id: "k02", version: 1, file_name: "x.pdf", storage_path: "k02/x.pdf" });
    const r = await send({ opId: OP(3), contractIds: ["k01"], attachDocIds: ["10000000-0000-4000-8000-000000000003"] });
    expect(r.status).toBe(400);
    expect(state.sent).toHaveLength(0);
  });
  it("cal confirmació explícita", async () => {
    const r = await send({ opId: OP(4), contractIds: ["k01"], confirmed: false });
    expect(r.status).toBe(400);
    expect(state.sent).toHaveLength(0);
  });
});

describe("Contactar tots · titulars diferents i autorització", () => {
  it("contractes de titulars diferents: es bloqueja fins que es registra l'autorització del destinatari", async () => {
    const pf = await api("POST", { action: "preflight", data: { contractIds: ["k01", "k03"], channel: "email", recipient: "joan.prova@exemple.cat" } });
    expect(pf.j.ok).toBe(false);
    expect(pf.j.holders).toHaveLength(2);
    expect(pf.j.blocking[0]).toMatch(/2 titulars diferents/);
    expect((await send({ opId: OP(5), contractIds: ["k01", "k03"] })).status).toBe(409);
    expect(state.sent).toHaveLength(0);
    for (const holderKey of ["cif:B11111111", "cif:H22222222"]) {
      const a = await api("POST", { action: "authorize", data: { contactKey: "email:joan.prova@exemple.cat", holderKey, basis: "representacio", note: "Administrador de la comunitat, acreditat per escrit" } });
      expect(a.status).toBe(200);
    }
    const ok = await send({ opId: OP(6), contractIds: ["k01", "k03"] });
    expect(ok.j.status).toBe("enviat");
  });
  it("un sol titular però destinatari diferent del que consta al contracte → cal autorització", async () => {
    const pf = await api("POST", { action: "preflight", data: { contractIds: ["k01"], channel: "email", recipient: "altra.persona@exemple.cat" } });
    expect(pf.j.ok).toBe(false);
    expect(pf.j.blocking[0]).toMatch(/no és la dada de contacte/);
  });
  it("respecta l'oposició a comunicacions comercials del client", async () => {
    state.sb.db.crm_supplies = [{ cups20: "ES0021000000000001AA".slice(0, 20), client_id: "cl1", cups: "ES0021000000000001AA", archived_at: null }];
    state.sb.db.crm_supplies[0].cups20 = String(contract("k01").cups).slice(0, 20);
    state.sb.db.crm_clients = [{ id: "cl1", contact_preference: "qualsevol", commercial_opt_out: true }];
    const pf = await api("POST", { action: "preflight", data: { contractIds: ["k01"], channel: "email", recipient: "joan.prova@exemple.cat" } });
    expect(pf.j.blocking.join(" ")).toMatch(/baixa de les comunicacions comercials/);
  });
});

describe("Contactar tots · errors, reintents i duplicats", () => {
  it("error SMTP: es registra com a error, no consta com a enviat", async () => {
    state.smtp = "error";
    const r = await send({ opId: OP(7), contractIds: ["k01", "k02"] });
    expect(r.j.status).toBe("error");
    expect(r.j.error).toBeTruthy();
    expect(state.sb.db.renewal_group_ops[0].status).toBe("error");
    expect(state.sb.db.activities.every((a) => a.delivery === "error")).toBe(true);
  });
  it("el servidor SMTP rebutja el destinatari → error", async () => {
    state.smtp = "rebutja";
    expect((await send({ opId: OP(8), contractIds: ["k01"] })).j.status).toBe("error");
  });
  it("clics repetits o reintents amb el mateix identificador: un sol enviament, una sola activitat per contracte", async () => {
    const [a, b] = await Promise.all([send({ opId: OP(9), contractIds: ["k01", "k02"] }), send({ opId: OP(9), contractIds: ["k01", "k02"] })]);
    const c = await send({ opId: OP(9), contractIds: ["k01", "k02"] });
    expect(state.sent).toHaveLength(1);
    expect([a.j.existed, b.j.existed, c.j.existed].filter(Boolean)).toHaveLength(2);
    expect(state.sb.db.renewal_group_ops).toHaveLength(1);
    expect(state.sb.db.activities).toHaveLength(2);
  });
  it("mateix contacte i mateixos contractes: avís de duplicat amb la data; només es reenvia si es confirma", async () => {
    await send({ opId: OP(10), contractIds: ["k02", "k01"] });
    const pf = await api("POST", { action: "preflight", data: { contractIds: ["k01", "k02"], channel: "email", recipient: "JOAN.PROVA@exemple.cat" } });
    expect(pf.j.lastSent?.at).toBeTruthy();
    const dup = await send({ opId: OP(11), contractIds: ["k01", "k02"] });
    expect(dup.status).toBe(409);
    expect(dup.j.error).toMatch(/^DUPLICAT/);
    const again = await send({ opId: OP(12), contractIds: ["k01", "k02"], confirmResend: true });
    expect(again.j.status).toBe("enviat");
    expect(state.sent).toHaveLength(2);
  });
});

describe("Contactar tots · WhatsApp", () => {
  it("mode enllaç: un sol missatge preparat, «pendent de confirmar» fins que l'usuari diu «L'he enviat»", async () => {
    const r = await api("POST", { action: "send", data: { opId: OP(13), channel: "whatsapp", recipient: "+34 600 11 22 33", body: "Bon dia", contractIds: ["k01", "k02"], confirmed: true } });
    expect(r.j.status).toBe("intent");
    expect(r.j.waLink).toMatch(/^https:\/\/wa\.me\/34600112233\?text=/);
    expect(state.sb.db.activities.every((a) => a.delivery === "preparado")).toBe(true);
    const c = await api("POST", { action: "confirm_wa", id: OP(13) });
    expect(c.j.status).toBe("registrat");
    expect(state.sb.db.activities.every((a) => a.delivery === "enviado")).toBe(true);
    expect((await api("POST", { action: "confirm_wa", id: OP(13) })).status).toBe(409); // no es confirma dues vegades
  });
  it("Cloud API (simulada): error de Meta → error; adjunta enllaços segurs als PDF", async () => {
    state.sb.db.user_whatsapp = [{ user_id: C1, mode: "cloud", default_number_id: "n1" }];
    const { env } = await import("@/server/env");
    (env as { waToken: string }).waToken = "simulat";
    state.cloud = "falla";
    state.sb.db.documents.push({ id: "10000000-0000-4000-8000-000000000009", contract_id: "k01", version: 1, file_name: "P.pdf", storage_path: "k01/p.pdf" });
    const r = await api("POST", { action: "send", data: { opId: OP(14), channel: "whatsapp", recipient: "600112233", body: "Bon dia", contractIds: ["k01"], attachDocIds: ["10000000-0000-4000-8000-000000000009"], confirmed: true } });
    expect(r.j.status).toBe("error");
    expect(state.cloudSent).toEqual(["34600112233"]);
    expect(String(state.sb.db.renewal_group_ops[0].body)).toContain("P.pdf: https://example/documents/k01/p.pdf?token=t");
    (env as { waToken: string }).waToken = "";
  });
});

describe("Permisos i històric", () => {
  it("permisos insuficients: si l'usuari no veu un dels contractes, no s'envia res ni es diu quin", async () => {
    state.sb.db.contracts = state.sb.db.contracts.filter((c) => c.id !== "k02"); // la RLS no li retorna k02
    const r = await send({ opId: OP(15), contractIds: ["k01", "k02"] });
    expect(r.status).toBe(403);
    expect(r.j.error).toBe("No tens permís sobre tots els contractes seleccionats");
    expect(state.sent).toHaveLength(0);
    expect(state.sb.db.renewal_group_ops).toHaveLength(0);
  });
  it("col·laborador: sense accés", async () => {
    state.who = { id: "k", role: "colaborador", name: "K" };
    expect((await api("GET")).status).toBe(403);
  });
  it("10 · una sola trucada vinculada a diversos contractes, consultable des de qualsevol", async () => {
    const r = await api("POST", { action: "activity", data: { opId: OP(16), kind: "trucada", channel: "telefon", contractIds: ["k01", "k02", "k03"], contactName: "Joan Prova", notes: "Vol revisar-ho la setmana vinent", outcome: "Interessat" } });
    expect(r.j.activities).toHaveLength(3);
    expect(r.j.activities[0]).toMatchObject({ type: "call", title: "Trucada conjunta amb Joan Prova (3 contractes) · Interessat" });
    const again = await api("POST", { action: "activity", data: { opId: OP(16), kind: "trucada", contractIds: ["k01"] } });
    expect(again.j.existed).toBe(true);
    for (const k of ["k01", "k03"]) {
      const ops = await api("GET", undefined, `?r=ops&contract=${k}`);
      expect(ops.j.ops.map((o: { id: string }) => o.id)).toEqual([OP(16)]);
    }
  });
  it("unir i separar: registra la decisió i una nota a cada contracte", async () => {
    state.sb.db.renewal_contact_links = [];
    const r = await api("POST", { action: "link", data: { kind: "separar", a: "k02", b: "k01", reason: "Persones diferents amb la mateixa centraleta" } });
    expect(r.j.link).toMatchObject({ kind: "separar", contract_a: "k01", contract_b: "k02" });
    expect(state.sb.db.activities.map((a) => a.contract_id).sort()).toEqual(["k01", "k02"]);
    const d = await api("GET");
    expect(d.j.links).toHaveLength(1);
    expect((await api("POST", { action: "link", data: { kind: "unir", a: "k01", b: "k01" } })).status).toBe(400);
  });
});
