/**
 * FASE 10 · Proves Playwright (PROVAT AMB SIMULACIÓ): tancar sessió, seguretat i contrasenya, agenda
 * (vistes, creació amb coincidència horària, disponibilitat, integració amb la fitxa 360º), calendaris
 * externs sense credencials i estats de les comercialitzadores.
 * Totes les respostes /api/** són inventades; no es toca cap servei real.
 *   node e2e/mkseed.mjs && npx vite build -c demo/vite.e2e.config.ts
 *   (cd demo/dist-e2e && python3 -m http.server 4174 &) · node e2e/fase10.e2e.cjs
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.E2E_URL || "http://localhost:4174/";
const C1 = "11111111-1111-4111-8111-111111111111";
const P = [{ id: "u-admin", name: "Direcció Demo", role: "admin" }, { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "Comercial Fictícia", role: "comercial" }, { id: "aaaaaaaa-0000-4000-8000-000000000003", name: "Administrativa Fictícia", role: "administrativa" }];
const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.toISOString(); };
const today = new Date();

function items() {
  return [
    { id: "e1", occurrenceId: "e1", source: "event", title: "Visita a client fictici", kind: "visita", scope: "compartida", start: at(today, 10), end: at(today, 11), allDay: false, status: "programada", priority: "alta", ownerId: "u-admin", ownerName: "Direcció Demo", participants: [{ userId: P[1].id, name: P[1].name, response: "accepta" }], client: { id: C1, name: "CLIENT FICTICI 1 SL" }, contractId: null, renewalId: "demo-1", incidentId: null, taskId: null, recurring: false, recurrence: null, reminders: [15], location: "Carrer Inventat 1", description: null, canEdit: true, external: null, createdByName: "Direcció Demo", version: 1 },
    { id: "e2", occurrenceId: `e2@${at(today, 9)}`, source: "event", title: "Reunió setmanal", kind: "reunio", scope: "compartida", start: at(today, 9), end: at(today, 9, 30), allDay: false, status: "programada", priority: "normal", ownerId: "u-admin", ownerName: "Direcció Demo", participants: [], client: null, contractId: null, renewalId: null, incidentId: null, taskId: null, recurring: true, recurrence: { freq: "weekly", byweekday: [1] }, reminders: [5], location: null, description: null, canEdit: true, external: null, createdByName: "Direcció Demo", version: 3 },
    { id: "t1", occurrenceId: "task:t1", source: "task", title: "Trucar per la renovació", kind: "tasca", scope: "personal", start: at(today, 16), end: at(today, 16, 30), allDay: false, status: "pendent", priority: "urgent", ownerId: "u-admin", ownerName: "Direcció Demo", participants: [], client: null, contractId: null, renewalId: null, incidentId: null, taskId: "t1", recurring: false, recurrence: null, reminders: [], location: null, description: null, canEdit: true, external: null, createdByName: null, version: null },
  ];
}
const detail = { client: { id: C1, kind: "empresa", name: "CLIENT FICTICI 1 SL", trade_name: null, tax_id: "B00000001", sector: null, status: "actiu", registered_at: "2026-01-01", contact_name: "Anna Exemple", contact_role: "Gerència", legal_rep_name: null, legal_rep_tax_id: null, legal_rep_role: null, contact_is_legal_rep: false, phone: "600000000", phone2: null, email: "c@exemple.test", address: null, postal_code: null, city: "Lleida", province: null, notes: null, owner_id: null, collaborator_id: null, origin: null, tags: [], priority: "mitjana", next_follow_up: null, created_at: today.toISOString(), updated_at: today.toISOString(), archived_at: null, owner_name: null, collaborator_name: null }, contacts: [], assignments: [], supplies: [], contracts: [], documents: [], activities: [], tasks: [], audit: [], comparisons: [], incidents: [{ id: "99999999-9999-4999-8999-999999999999", client_id: C1, supply_id: null, contract_id: null, kind: "incidencia", category: null, title: "Factura duplicada (prova)", description: null, status: "oberta", priority: "alta", external_ref: null, opened_at: today.toISOString(), closed_at: null }], expedients: [], opportunities: [], permissions: { canEdit: true, canSeeSensitive: true, isStaff: true, canAssign: true, canDeleteDocs: true }, summary: { activeContracts: 0, pendingRenewals: 0, openIncidents: 1, comparisonsInProgress: 0 }, drafts: [] };
const retailers = [
  { id: "r-1", trade_name: "Fictícia Activa", legal_name: null, tax_id: null, aliases: [], website: null, contact_name: null, phone: null, email: null, services: ["llum"], status: "activa", special_conditions: null, notes: null, logo_path: null, documents: 1, vigents: 1, venciments: 0, pendents: 0 },
  { id: "r-2", trade_name: "Fictícia Desactivada", legal_name: null, tax_id: null, aliases: [], website: null, contact_name: null, phone: null, email: null, services: ["gas"], status: "inactiva", special_conditions: null, notes: null, logo_path: null, documents: 0, vigents: 0, venciments: 0, pendents: 0, status_changed_by_name: "Direcció Demo", status_changed_at: today.toISOString() },
  { id: "r-3", trade_name: "Fictícia Arxivada", legal_name: null, tax_id: null, aliases: [], website: null, contact_name: null, phone: null, email: null, services: [], status: "arxivada", special_conditions: null, notes: null, logo_path: null, documents: 0, vigents: 0, venciments: 0, pendents: 0 },
];

async function setup(page, s) {
  await page.route("https://e2e.invalid/**", (r) => r.abort());
  await page.route("**/api/**", async (r) => {
    const req = r.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method();
    const json = (j, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(j) });
    const body = () => JSON.parse(req.postData() || "{}");
    if (p === "/api/agenda") {
      if (m === "POST") {
        const b = body(); s.posts.push(b);
        if (b.action === "save" && !b.data.force && /Visita/.test(b.data.title)) return json({ needsConfirm: true, conflicts: [{ userId: P[1].id, name: "Comercial Fictícia", start: b.data.starts_at, end: b.data.ends_at, title: null, kind: null }] });
        if (b.action === "tick") return json({ sent: 0, migrated: true });
        return json({ ok: true, id: "nou" });
      }
      const k = u.searchParams.get("r");
      s.gets.push(Object.fromEntries(u.searchParams));
      if (k === "list") return json({ items: u.searchParams.get("view") === "compartida" ? items().filter((i) => i.scope === "compartida") : items(), people: P, me: "u-admin", canAssign: true });
      if (k === "availability") return json({ users: (u.searchParams.get("users") || "").split(",").map((id) => ({ id, name: (P.find((x) => x.id === id) || {}).name || "—", known: id !== P[2].id })), busy: [{ userId: P[1].id, start: at(today, 10), end: at(today, 11), private: true }], suggestions: [{ start: at(new Date(today.getTime() + 86400000), 9), end: at(new Date(today.getTime() + 86400000), 10), uncertain: [P[2].id] }] });
      if (k === "summary") return json({ today: [{ id: "t1", title: "Trucar per la renovació", due_at: at(today, 16), status: "pendent", priority: "urgent", client: null, contract_id: null, incident: null }], overdue: [{ id: "t0", title: "Enviar documentació", due_at: at(new Date(today.getTime() - 2 * 86400000), 12), status: "pendent", priority: "normal", client: { id: C1, name: "CLIENT FICTICI 1 SL" }, contract_id: null, incident: null }], assigned: [], incidentTasks: [], upcoming: items().slice(0, 2), assignedEvents: [], agendaMissing: false, canAssign: true });
      if (k === "linked") return json({ events: [{ id: "e1", title: "Visita a client fictici", kind: "visita", starts_at: at(new Date(today.getTime() + 86400000), 10), ends_at: at(new Date(today.getTime() + 86400000), 11), status: "programada", priority: "normal" }], migrated: true });
    }
    if (p === "/api/work") { s.posts.push(body()); return json({ ok: true }); }
    if (p === "/api/account") { const b = body(); s.posts.push(b); return b.current === "incorrecta" ? json({ error: "La contrasenya actual no és correcta." }, 400) : json({ ok: true }); }
    if (p === "/api/calendar") return json({ migrated: true, providers: { google: { configured: false, missing: ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"] }, microsoft: { configured: false, missing: ["MICROSOFT_CALENDAR_CLIENT_ID", "MICROSOFT_CALENDAR_CLIENT_SECRET"] } }, redirectUris: { google: "https://crm.exemple.test/api/calendar/callback?provider=google", microsoft: "https://crm.exemple.test/api/calendar/callback?provider=microsoft" }, connections: [] });
    if (p === "/api/retailers") {
      if (m === "POST") { const b = body(); s.posts.push(b); return json({ ok: true, status: b.data?.status }); }
      const k = u.searchParams.get("r");
      if (k === "list") return json({ rows: retailers, ai: { configured: false, policy: { enabled: false } }, canEdit: true, canApprove: true, economic: false });
      if (k === "options") return json({ options: [{ name: "Fictícia Activa", aliases: [], status: "activa" }], blocked: [{ name: "Fictícia Desactivada", aliases: [], status: "inactiva" }] });
      if (k === "deps") return json({ deps: [{ label: "Contractes del CRM", count: 4 }], total: 4, safe: false });
      if (k === "get") { const rr = retailers.find((x) => x.id === u.searchParams.get("id")); return json({ retailer: rr, documents: [], terms: [], rules: [], clawbacks: [], extractions: [], ai: { configured: false, policy: { enabled: false } }, canEdit: true, canApprove: true }); }
    }
    if (p.startsWith("/api/crm/clients/")) return json(detail);
    if (p === "/api/crm/clients") return json(u.searchParams.get("facets") ? { cities: [], provinces: [], sectors: [], origins: [], users: [] } : { rows: [], total: 0, page: 1, size: 25, counters: { actiu: 0, potencial: 0, inactiu: 0 } });
    if (p === "/api/nav") return json(m === "POST" ? { ok: true } : { items: [], draft: null, drafts: [] });
    return json({ error: "simulació: no implementat" }, 404);
  });
}

const results = [];
async function test(name, fn) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const s = { posts: [], gets: [] };
  await setup(page, s);
  try { await fn(page, s); assert.deepEqual(errors, [], `errors JS: ${errors.join(" | ")}`); results.push([name, "OK"]); }
  catch (e) { results.push([name, `FALLA: ${e.message.split("\n")[0]}`]); await page.screenshot({ path: `e2e/fail10-${results.length}.png` }).catch(() => undefined); }
  finally { await browser.close(); }
}

(async () => {
  await test("1. Menú d'usuari: «Tanca la sessió» neteja l'estat i porta a l'inici de sessió", async (page) => {
    await page.goto(`${BASE}?v=kanban`);
    await page.evaluate(() => { sessionStorage.setItem("a30:vs:clients.page", "3"); localStorage.setItem("a30:recents", "[]"); });
    await page.getByRole("button", { name: "Menú d'usuari" }).click();
    await page.getByRole("menuitem", { name: "Seguretat i contrasenya" }).waitFor();
    await page.getByRole("menuitem", { name: "Tanca la sessió" }).click();
    await page.waitForURL(/\/login/);
    const left = await page.evaluate(() => [sessionStorage.length, localStorage.getItem("a30:recents")]);
    assert.deepEqual(left, [0, null]);
  });

  await test("2. Seguretat: requisits de la contrasenya, error de l'actual i canvi correcte", async (page, s) => {
    await page.goto(`${BASE}?v=perfil&tab=seguretat`);
    const form = page.getByRole("form", { name: "Canvi de contrasenya" });
    await form.getByLabel("Contrasenya nova").fill("curta");
    await form.getByText("Ha de tenir com a mínim 10 caràcters.").waitFor();
    assert.equal(await form.getByRole("button", { name: /Desa la contrasenya nova/ }).isDisabled(), true);
    await form.getByLabel("Contrasenya actual").fill("incorrecta");
    await form.getByLabel("Contrasenya nova").fill("Riu-Verd-7-Mussol");
    await form.getByLabel("Repeteix la nova").fill("Riu-Verd-7-Mussol");
    await form.getByRole("button", { name: /Desa la contrasenya nova/ }).click();
    await form.getByText("La contrasenya actual no és correcta.").waitFor();
    await form.getByLabel("Contrasenya actual").fill("actual-ficticia-1");
    await form.getByRole("button", { name: /Desa la contrasenya nova/ }).click();
    await form.getByText(/Contrasenya canviada/).waitFor();
    assert.ok(s.posts.some((p) => p.action === "password" && p.next === "Riu-Verd-7-Mussol"));
  });

  await test("3. Agenda: vista setmanal, mensual i diària; personal / compartida / combinada", async (page, s) => {
    await page.goto(`${BASE}?v=agenda`);
    await page.getByRole("button", { name: /Visita a client fictici/ }).first().waitFor();
    await page.getByRole("button", { name: /Trucar per la renovació/ }).first().waitFor(); // tasca del gestor de tasques
    await page.getByRole("radio", { name: "mes" }).click();
    await page.getByRole("gridcell").first().waitFor();
    await page.getByRole("radio", { name: "dia" }).click();
    await page.getByRole("tab", { name: "Agenda compartida" }).click();
    await page.waitForTimeout(400);
    assert.ok(s.gets.some((g) => g.view === "compartida"));
    await page.getByRole("tab", { name: "La meva agenda" }).click();
    await page.waitForTimeout(400);
    assert.ok(s.gets.some((g) => g.view === "personal"));
  });

  await test("4. Nova cita: avís de coincidència horària i «Desa igualment»", async (page, s) => {
    await page.goto(`${BASE}?v=agenda`);
    await page.getByRole("button", { name: "Nova cita", exact: true }).click();
    const dlg = page.getByRole("dialog").filter({ hasText: "Nova cita" });
    await dlg.getByRole("radio", { name: "Visita comercial" }).click();
    await dlg.getByLabel("Títol *").fill("Visita de prova");
    await dlg.getByLabel("Afegeix participants").selectOption({ label: "Comercial Fictícia" });
    await dlg.getByText("ocupat/da").waitFor(); // disponibilitat de la participant
    await dlg.getByRole("button", { name: "5 minuts", exact: true }).click();
    await dlg.getByRole("button", { name: "Crea la cita" }).click();
    await page.getByRole("alertdialog", { name: "Coincidència horària" }).waitFor();
    await dlg.getByText("ocupat (cita privada)").waitFor(); // no es revela el títol de la cita privada
    await page.getByRole("button", { name: "Desa igualment" }).click();
    await page.getByText("Cita creada").waitFor();
    const saves = s.posts.filter((p) => p.action === "save");
    assert.equal(saves.length, 2);
    assert.equal(saves[1].data.force, true);
    assert.deepEqual(saves[1].data.reminders.sort((a, b) => a - b), [5, 15]);
  });

  await test("5. Disponibilitat de l'equip: ocupat, sense informació i franges proposades", async (page) => {
    await page.goto(`${BASE}?v=agenda`);
    await page.getByRole("tab", { name: "Disponibilitat de l'equip" }).click();
    await page.getByText("Ocupat", { exact: true }).first().waitFor();
    await page.getByText("sense informació d'agenda").first().waitFor();
    await page.getByText(/Franges lliures per a tothom/).waitFor();
    await page.getByRole("button", { name: /a confirmar/ }).first().click();
    await page.getByRole("dialog").filter({ hasText: "Nova cita" }).waitFor(); // obre la reunió a la franja triada
  });

  await test("6. Des de la fitxa 360º: «Programar trucada» i agenda del client; tornar a l'agenda conserva la data", async (page) => {
    await page.goto(`${BASE}?v=agenda`);
    await page.getByRole("radio", { name: "setmana" }).click();
    await page.getByRole("button", { name: "Següent" }).click();
    const title = await page.locator("span[aria-live=polite]").first().innerText();
    await page.getByRole("button", { name: "Anterior" }).click();
    await page.getByRole("button", { name: /Visita a client fictici/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "CLIENT FICTICI 1 SL" }).click();
    await page.locator("main h2.text-xl").filter({ hasText: /^CLIENT FICTICI 1 SL$/ }).waitFor();
    await page.getByText("Agenda del client").waitFor();
    await page.getByRole("button", { name: "Programar trucada" }).first().click();
    const dlg = page.getByRole("dialog").filter({ hasText: "Nova cita" });
    assert.equal(await dlg.getByLabel("Títol *").inputValue(), "Trucar a CLIENT FICTICI 1 SL");
    await dlg.getByText("CLIENT FICTICI 1 SL").first().waitFor();
    await dlg.getByRole("button", { name: "Cancel·la" }).click();
    await page.getByRole("button", { name: "Programar seguiment" }).last().waitFor(); // a la incidència oberta
    await page.goBack();
    await page.waitForURL(/v=agenda/);
    await page.getByRole("button", { name: "Següent" }).click();
    assert.equal(await page.locator("span[aria-live=polite]").first().innerText(), title);
  });

  await test("7. Kanban: recordatoris del contracte i accions de l'agenda a la fitxa", async (page) => {
    await page.goto(`${BASE}?v=kanban`);
    await page.getByText("Client Fictici 1 Sl", { exact: false }).first().click();
    const d = page.getByRole("dialog", { name: /Fitxa de/ });
    await d.getByText("Recordatoris i cites del contracte").waitFor();
    await d.getByRole("button", { name: /Visita a client fictici/ }).waitFor();
    await d.getByRole("button", { name: "Crear recordatori" }).click();
    const f = page.getByRole("dialog").filter({ hasText: "Nova cita" });
    await f.getByText(/Vinculada a: contracte de renovació/).waitFor();
  });

  await test("8. Connectar calendari: sense credencials OAuth no es mostra com a connectat", async (page) => {
    await page.goto(`${BASE}?v=agenda`);
    await page.getByRole("button", { name: "Connectar calendari" }).click();
    const d = page.getByRole("dialog").filter({ hasText: "Connectar calendari" });
    await d.getByText(/falten variables a Vercel \(GOOGLE_CALENDAR_CLIENT_ID/).waitFor();
    assert.equal(await d.getByText(/^Connectat/).count(), 0);
    assert.equal(await d.getByText("No connectat").count(), 2);
    assert.equal(await d.getByRole("button", { name: /Connecta Google/ }).count(), 0);
  });

  await test("9. Panell d'inici: tasques d'avui i vençudes amb accions ràpides", async (page, s) => {
    await page.goto(`${BASE}?v=control`);
    const card = page.getByRole("region", { name: "Tasques i agenda" });
    await card.getByText("Trucar per la renovació").waitFor();
    await card.getByRole("tab", { name: /Vençudes/ }).click();
    await card.getByText("Enviar documentació").waitFor();
    await card.getByRole("button", { name: "+1 d" }).click();
    await card.getByRole("button", { name: /Completa Enviar documentació/ }).click();
    await page.waitForTimeout(300);
    assert.ok(s.posts.some((p) => p.action === "task_update" && p.data.status === "feta"));
    assert.ok(s.posts.some((p) => p.action === "task_update" && p.data.due_at));
  });

  await test("10. Comercialitzadores: filtres d'estat, reactivar i eliminació bloquejada per dependències", async (page, s) => {
    await page.goto(`${BASE}?v=comercialitzadores`);
    await page.getByText("Fictícia Activa").waitFor();
    assert.equal(await page.getByText("Fictícia Arxivada").count(), 0);
    await page.getByRole("radio", { name: /Desactivades/ }).click();
    await page.getByText("Fictícia Desactivada").click();
    await page.getByText(/no apareix als selectors/).waitFor();
    await page.getByRole("button", { name: "Reactiva" }).click();
    await page.waitForTimeout(300);
    assert.ok(s.posts.some((p) => p.action === "set_status" && p.data.status === "activa"));
    await page.getByRole("button", { name: "Elimina…" }).click();
    const d = page.getByRole("dialog").filter({ hasText: "Eliminar" });
    await d.getByText("No es pot eliminar").waitFor();
    await d.getByText(/Contractes del CRM: 4/).waitFor();
    assert.equal(await d.getByRole("button", { name: "Elimina definitivament" }).count(), 0);
  });

  console.log("\nPROVES FASE 10 (simulació, sense serveis reals)");
  for (const [n, r] of results) console.log(`${r === "OK" ? "✔" : "✘"} ${n} — ${r}`);
  process.exit(results.every(([, r]) => r === "OK") ? 0 : 1);
})();
