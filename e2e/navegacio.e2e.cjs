/**
 * FASE 9 · Proves Playwright de navegació i continuïtat (PROVAT AMB SIMULACIÓ).
 *
 * S'executen sobre la demo (mateixos components que la web) amb TOTES les crides /api/** respostes per
 * aquest fitxer amb dades inventades. No toquen Supabase ni cap servei real.
 *
 *   node e2e/mkseed.mjs && npx vite build -c demo/vite.e2e.config.ts
 *   (cd demo/dist-e2e && python3 -m http.server 4174 &)  ·  node e2e/navegacio.e2e.cjs
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = process.env.E2E_URL || "http://localhost:4174/";
const C1 = "11111111-1111-4111-8111-111111111111";
const C0 = "33333333-3333-4333-8333-333333333333";
const S1 = "22222222-2222-4222-8222-222222222222";
const CUPS1 = "ES0000000000000001XX0F";
const now = "2026-11-02T10:00:00.000Z";

const client = (id, name, extra = {}) => ({
  id, kind: "empresa", name, trade_name: null, tax_id: "B00000001", tax_id_type: "cif", sector: "Comerç", status: "actiu", registered_at: "2026-01-01",
  contact_name: "Anna Exemple", contact_role: "Gerència", legal_rep_name: "Pere Exemple", legal_rep_tax_id: "__masked__", legal_rep_role: "administrador", contact_is_legal_rep: false,
  phone: "600000000", phone2: null, email: "contacte@exemple.test", address: "Carrer Inventat 1", postal_code: "25001", city: "Lleida", province: "Lleida", notes: null,
  owner_id: null, collaborator_id: null, origin: null, tags: [], priority: "mitjana", next_follow_up: null, created_at: now, updated_at: now, archived_at: null, owner_name: "Comercial Demo", collaborator_name: null, ...extra,
});
const detail = (id, name) => ({
  client: client(id, name), contacts: [], assignments: [],
  supplies: [{ id: S1, client_id: id, cups: CUPS1, energy_type: "luz", address: "Carrer Inventat 1", postal_code: "25001", city: "Lleida", province: "Lleida", holder_name: name, current_retailer: "Nufri", access_tariff: "3.0TD", power_kw: [15, 15, 15, 15, 15, 15], annual_kwh: 28930, period_kwh: null, status: "actiu", current_contract_id: null, data_source: "manual", data_updated_at: now, notes: null, created_at: now, archived_at: null }],
  contracts: [], documents: [], activities: [], tasks: [], audit: [], comparisons: [], incidents: [], expedients: [], opportunities: [],
  permissions: { canEdit: true, canSeeSensitive: false, isStaff: false, canAssign: false, canDeleteDocs: false },
  summary: { activeContracts: 2, pendingRenewals: 1, openIncidents: 0, comparisonsInProgress: 1 },
  drafts: [{ id: "44444444-4444-4444-8444-444444444444", context_key: `client:${id}`, contract_id: null, crm_supply_id: null, cups: CUPS1, client_name: name, step: 2, created_by_name: "Comercial Demo", updated_by_name: "Comercial Demo", updated_at: now }],
});

async function setup(page, state) {
  await page.route("https://e2e.invalid/**", (r) => r.abort());
  await page.route("**/api/**", async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const p = u.pathname;
    const json = (j, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(j) });
    if (p === "/api/nav") {
      if (req.method() === "POST") {
        const b = JSON.parse(req.postData() || "{}");
        state.posts.push(b);
        if (b.action === "draft_save") { state.version += 1; state.saved = b.data; return json({ id: "55555555-5555-4555-8555-555555555555", version: state.version, savedAt: new Date().toISOString() }); }
        return json({ ok: true });
      }
      const k = u.searchParams.get("r");
      if (k === "resolve") return json({ linked: true, clientId: C1, clientName: "CLIENT FICTICI 1 SL", contractId: null, supplyId: S1, via: "cups" });
      if (k === "supply") return json({ cups: CUPS1, cups20: CUPS1.slice(0, 20), supplies: detail(C1, "CLIENT FICTICI 1 SL").supplies.map((s) => ({ ...s, client: { id: C1, name: "CLIENT FICTICI 1 SL", kind: "empresa" } })), contracts: [], holders: [{ clientId: C0, name: "ANTIC TITULAR FICTICI SL", from: "2019-01-01", to: "2023-12-31", current: false, contracts: 1 }, { clientId: C1, name: "CLIENT FICTICI 1 SL", from: "2024-01-01", to: null, current: true, contracts: 1 }] });
      if (k === "recent") return json({ items: [] });
      if (k === "draft") return json({ draft: state.offer ?? null });
      return json({ drafts: [] });
    }
    if (p === "/api/crm/clients" && u.searchParams.get("facets")) return json({ cities: [], provinces: [], sectors: [], origins: [], users: [] });
    if (p === "/api/crm/clients" && u.searchParams.get("check")) return json({ taxId: null, similar: [] });
    if (p === "/api/crm/clients") return json({ rows: [], total: 0, page: 1, size: 25, counters: { actiu: 0, potencial: 0, inactiu: 0 } });
    if (p.startsWith("/api/crm/clients/")) {
      const id = decodeURIComponent(p.split("/").pop());
      if (req.method() === "PATCH") return json({ id });
      return json(detail(id, id === C0 ? "ANTIC TITULAR FICTICI SL" : "CLIENT FICTICI 1 SL"));
    }
    if (p === "/api/crm/search") return json({ results: [
      { kind: "client", id: C1, title: "CLIENT FICTICI 1 SL", sub: "B0000***1 · Lleida", status: "actiu" },
      { kind: "supply", id: C1, title: CUPS1, sub: "Llum · CLIENT FICTICI 1 SL", status: null },
      { kind: "incident", id: C1, title: "Factura duplicada (prova)", sub: "Incidència · CLIENT FICTICI 1 SL", status: "oberta" },
    ] });
    if (p.startsWith("/api/sips/supply")) return json({ entry: { cups: CUPS1.slice(0, 20), returned_cups: CUPS1, annual_kwh: 31000, tariff: "3.0TD", address: "Carrer Inventat 1, Lleida", status: "found", consulted_at: now, contracted_power_kw: [15, 15, 15, 15, 15, 20], retailer: "Comercialitzadora SIPS (fictícia)" }, inCrm: true });
    return json({ error: "simulació: no implementat" }, 404);
  });
}

const results = [];
async function test(name, fn) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const state = { posts: [], version: 0, saved: null, offer: null };
  await setup(page, state);
  try {
    await fn(page, state);
    assert.deepEqual(errors, [], `errors JS: ${errors.join(" | ")}`);
    results.push([name, "OK"]);
  } catch (e) {
    results.push([name, `FALLA: ${e.message.split("\n")[0]}`]);
    await page.screenshot({ path: `e2e/fail-${results.length}.png` }).catch(() => undefined);
  } finally { await browser.close(); }
}
/** Capçalera de la fitxa 360º (s'ignoren les targetes de la pantalla anterior mentre s'esvaeix). */
const clientHeading = (page, name) => page.locator("main h2.text-xl").filter({ hasText: new RegExp(`^${name}$`) }).waitFor();
const openKanbanDrawer = async (page) => {
  await page.goto(`${BASE}?v=kanban`);
  await page.getByText("Client Fictici 1 Sl", { exact: false }).first().click();
  await page.getByRole("dialog", { name: /Fitxa de/ }).waitFor();
};

(async () => {
  await test("1. Nom del client al calaix → fitxa 360º → Enrere torna al Kanban amb el calaix obert", async (page) => {
    await openKanbanDrawer(page);
    await page.getByRole("dialog", { name: /Fitxa de/ }).getByTitle("Obre la fitxa 360º del client").first().click();
    await clientHeading(page, "CLIENT FICTICI 1 SL");
    assert.ok(page.url().includes("v=client"));
    await page.getByRole("button", { name: "Enrere", exact: true }).click();
    await page.getByRole("dialog", { name: /Fitxa de CLIENT FICTICI 1 SL/ }).waitFor({ timeout: 4000 });
    assert.ok(page.url().includes("v=kanban"));
  });

  await test("2. CUPS clicable → punt de subministrament amb titulars → fitxa d'un titular anterior", async (page) => {
    await openKanbanDrawer(page);
    await page.getByRole("button", { name: /Punt de subministrament ES0000000000000001XX0F/ }).first().click();
    const m = page.getByRole("dialog").filter({ hasText: "Titulars d'aquest punt" });
    await m.waitFor();
    await m.getByText("Titular actual").waitFor();
    await m.getByRole("button", { name: /ANTIC TITULAR FICTICI SL/ }).click();
    await clientHeading(page, "ANTIC TITULAR FICTICI SL");
  });

  await test("3. Filtres i ordre de Cartera es conserven en anar i tornar", async (page) => {
    await page.goto(`${BASE}?v=cartera`);
    const sel = page.locator("main select").first();
    await sel.waitFor();
    const opts = await sel.locator("option").allTextContents();
    await sel.selectOption({ index: Math.min(1, opts.length - 1) });
    const chosen = await sel.inputValue();
    await page.getByText("Client Fictici 2 Sl", { exact: false }).first().click();
    await page.getByRole("dialog", { name: /Fitxa de/ }).getByTitle("Obre la fitxa 360º del client").first().click();
    await clientHeading(page, "CLIENT FICTICI 1 SL");
    await page.goBack();
    await page.waitForURL(/v=cartera/);
    await page.locator("main select").first().waitFor();
    assert.equal(await page.locator("main select").first().inputValue(), chosen, `opcions: ${opts.join("/")}`);
  });

  await test("4. Canvis sense desar: diàleg Desa i surt / Surt sense desar / Cancel·la", async (page) => {
    await openKanbanDrawer(page);
    await page.getByRole("dialog", { name: /Fitxa de/ }).getByTitle("Obre la fitxa 360º del client").first().click();
    await clientHeading(page, "CLIENT FICTICI 1 SL");
    // persona de contacte i representant legal, amb el DNI ocult per a qui no té permís
    await page.getByTestId("representant-legal").getByText("Ocult (sense permís)").waitFor();
    await page.getByTestId("contacte-habitual").getByText("Gerència").waitFor();
    await page.locator("main").getByRole("button", { name: "Edita", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Contacte/ }).first().click().catch(() => undefined);
    const name = page.getByRole("dialog").getByLabel("Persona de contacte habitual");
    await name.fill("CLIENT FICTICI 1 SL MODIFICAT");
    await page.goBack(); // el formulari és un modal: s'hi surt amb l'enrere del navegador
    const leave = page.getByRole("dialog").filter({ hasText: "Tens canvis sense desar" });
    await leave.waitFor();
    for (const b of ["Desa i surt", "Surt sense desar", "Cancel·la"]) await leave.getByRole("button", { name: b }).waitFor();
    await leave.getByRole("button", { name: "Cancel·la" }).click();
    assert.ok(page.url().includes("v=client"));
    await page.goBack();
    await page.getByRole("dialog").filter({ hasText: "Tens canvis sense desar" }).getByRole("button", { name: "Surt sense desar" }).click();
    await page.waitForURL(/v=kanban/);
  });

  await test("5. Comparativa → SIPS → «Tornar a la comparativa» amb les dades intactes, i importació amb comparació", async (page, state) => {
    await page.goto(`${BASE}?v=comparativa&contract=demo-1`);
    await page.getByRole("button", { name: /Completament manual/ }).click();
    await page.getByRole("button", { name: "Importa dades del SIPS" }).click();
    const imp = page.getByRole("dialog").filter({ hasText: "Importar dades del SIPS" });
    await imp.waitFor();
    // la potència i el consum venien del CRM: es poden importar; cap camp manual queda marcat sol
    await imp.getByText("Potències contractades").waitFor();
    await imp.getByRole("button", { name: "Cancel·la" }).click();
    await page.getByRole("button", { name: "Consulta el SIPS" }).click();
    await page.waitForURL(/v=fitxa/);
    await page.getByRole("button", { name: /Tornar a la comparativa/ }).click();
    await page.waitForURL(/v=comparativa/);
    await page.getByRole("button", { name: "Comença de nou" }).waitFor(); // continua al pas 2, no s'ha reiniciat
    assert.ok(state.posts.every((x) => x.action !== "draft_close"), "no s'ha descartat l'esborrany");
  });

  await test("6. Esborrany automàtic: «Canvis guardats» i oferta per reprendre'l", async (page, state) => {
    await page.goto(`${BASE}?v=comparativa&contract=demo-2`);
    await page.getByRole("button", { name: /Completament manual/ }).click();
    await page.getByTestId("draft-status").filter({ hasText: "Canvis guardats" }).waitFor({ timeout: 6000 });
    const save = state.posts.find((x) => x.action === "draft_save");
    assert.equal(save.data.contract, "demo-2");
    assert.equal(save.data.state.catalog, undefined, "el catàleg no es desa");
    state.offer = { id: "66666666-6666-4666-8666-666666666666", version: 3, step: 2, state: save.data.state, updated_at: new Date().toISOString(), updated_by_name: "Comercial Demo", client_name: "Client Fictici 2 Sl", status: "obert", context_key: "contract:demo-2" };
    await page.reload();
    await page.getByRole("button", { name: "Reprèn-la" }).click();
    await page.getByRole("button", { name: "Comença de nou" }).waitFor();
  });

  await test("7. Cercador global agrupat (NIF emmascarat) i resultat CUPS → punt de subministrament", async (page) => {
    await page.goto(`${BASE}?v=kanban`);
    await page.locator("header").getByLabel("Cercador global").fill("fictici");
    const list = page.locator("header ul");
    await list.getByText("Punts de subministrament (CUPS)").waitFor();
    await list.getByText("Incidències", { exact: true }).waitFor();
    await list.getByText("B0000***1 · Lleida").waitFor();
    await page.getByRole("button", { name: new RegExp(CUPS1) }).first().dispatchEvent("mousedown");
    await page.getByRole("dialog").filter({ hasText: "Titulars d'aquest punt" }).waitFor();
  });

  console.log("\nPROVES DE NAVEGACIÓ (simulació, sense Supabase real)");
  for (const [n, r] of results) console.log(`${r === "OK" ? "✔" : "✘"} ${n} — ${r}`);
  process.exit(results.every(([, r]) => r === "OK") ? 0 : 1);
})();
