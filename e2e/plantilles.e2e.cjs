/**
 * FASE 11 · Proves Playwright (PROVAT AMB SIMULACIÓ al navegador): plantilles de lectura amb l'Excel REAL de
 * Naturgy, xat d'ensenyament, verificació, segon Excel equivalent, format canviat, reconeixement des del lector de
 * tarifes i comparador fix vs indexat. Totes les respostes /api/** són simulades; els Excel són el real i dues
 * còpies modificades (npx tsx scripts/e2e-naturgy-fixtures.ts). La indexada és una fórmula DE PROVA.
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.E2E_URL || "http://localhost:4174/";
const ROOT = path.resolve(__dirname, "..");
const N = (f) => path.join(__dirname, "naturgy", f);
const SAMPLE = fs.readFileSync(path.join(ROOT, "tests/fixtures/naturgy/NC-Productos-Captacion-PYMES-20261029-VP.xlsx"));
const NEXT = fs.readFileSync(N("NC-Productos-Captacion-PYMES-20261128-VP.xlsx"));
const BAD = fs.readFileSync(N("NC-format-canviat.xlsx"));
const DEF = JSON.parse(fs.readFileSync(N("def.json"), "utf8"));
const READ = JSON.parse(fs.readFileSync(N("read.json"), "utf8"));
const CATALOG = JSON.parse(fs.readFileSync(N("catalog.json"), "utf8"));
const XMIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const now = new Date().toISOString();

const retailer = { retailer: { id: "r-ng", trade_name: "Naturgy", legal_name: null, tax_id: null, aliases: [], website: null, contact_name: null, phone: null, email: null, services: ["llum", "gas"], status: "activa", special_conditions: null, notes: null, logo_path: null, logoUrl: null }, documents: [], extractions: [], terms: [], rules: [], clawbacks: [], ai: { configured: false, policy: { enabled: false, dpa_reference: null, zero_retention: false, no_training: false, confirmed_by: null, confirmed_at: null, note: null } }, canEdit: true, canApprove: true, productContracts: null };
const tplRow = (status) => ({ id: "tpl-naturgy", retailer_id: "r-ng", supplier: "Naturgy", name: "Captación PYMES Excel", doc_type: "xlsx", status, active: true, current_version: 2, verified_version: status === "verificada" ? 2 : null, verified_at: status === "verificada" ? now : null, verified_by_name: status === "verificada" ? "Direcció Demo" : null, last_read_at: null, last_read_status: null, last_errors: [], validated_pct: null, created_by_name: "Direcció Demo", created_at: now, updated_at: now });

async function setup(page, s) {
  await page.route("https://e2e.invalid/**", (r) => r.abort());
  await page.route("**/api/**", async (r) => {
    const req = r.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method();
    const json = (j, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(j) });
    const body = () => JSON.parse(req.postData() || "{}");
    if (p === "/api/retailers") return u.searchParams.get("r") === "get" ? json(retailer) : json({ rows: [], ai: retailer.ai, canEdit: true, canApprove: true, economic: false });
    if (p === "/api/tariffs/reading-templates") {
      if (m === "GET") {
        const r0 = u.searchParams.get("r");
        if (r0 === "get") return json({ template: tplRow(s.status), version: { version: 2, definition: DEF, sample_name: "NC-Productos-Captacion-PYMES-20261029-VP.xlsx", sample_grid: null, checks: [], note: null, created_by_name: "Direcció Demo", created_at: now }, versions: [{ version: 2, note: "Variable Luz i Variable Gas: preu fix revisable", sample_name: null, created_by_name: "Direcció Demo", created_at: now }, { version: 1, note: "Proposta inicial", sample_name: null, created_by_name: "Direcció Demo", created_at: now }], corrections: [], reads: [] });
        if (r0 === "previous") return json({ read: { id: "rd-1", file_name: "NC-Productos-Captacion-PYMES-20261029-VP.xlsx", created_at: now, summary: READ } });
        return json({ templates: s.status ? [tplRow(s.status)] : [], defs: s.status ? [{ templateId: "tpl-naturgy", version: 2, definition: DEF }] : [], migrated: true });
      }
      const b = body(); s.posts.push(b);
      if (b.action === "create") { s.status = "pendent"; return json({ template: tplRow("pendent"), checks: [] }); }
      if (b.action === "verify") { s.status = "verificada"; return json({ verified: true, checks: [], template: tplRow("verificada") }); }
      if (b.action === "read") return json({ id: `rd-${s.posts.length}`, status: b.data.result.compatibility.status });
      return json({ ok: true });
    }
    if (p === "/api/tariffs/import") { const b = body(); s.imports.push(b); return json({ runId: "x", saved: b.offers.length, activated: 0 }); }
    if (p === "/api/tariffs/ai-read") return m === "GET" ? json({ ai: false }) : json({ error: "IA no configurada" }, 400);
    if (p === "/api/tariffs") return json(CATALOG);
    return json({ error: "simulació: no implementat" }, 404);
  });
}
async function dropFile(page, locator, name, bytes, type) {
  const dt = await page.evaluateHandle(({ name, b64, type }) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const d = new DataTransfer(); d.items.add(new File([u], name, { type })); return d; }, { name, b64: Buffer.from(bytes).toString("base64"), type });
  for (const ev of ["dragenter", "dragover", "drop"]) await locator.dispatchEvent(ev, { dataTransfer: dt });
}
const results = [];
async function test(name, fn, state = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const s = { status: null, posts: [], imports: [], ...state };
  await setup(page, s);
  try { await fn(page, s); assert.deepEqual(errors, [], `errors JS: ${errors.join(" | ")}`); results.push([name, "OK"]); }
  catch (e) { results.push([name, `FALLA: ${e.message.split("\n")[0]}`]); await page.screenshot({ path: path.join(__dirname, `fail-tpl-${results.length}.png`) }).catch(() => undefined); }
  finally { await browser.close(); }
}
const openTemplates = async (page) => {
  await page.goto(`${BASE}?v=comercialitzadora&id=r-ng`);
  await page.getByRole("tab", { name: "Plantilles de lectura IA" }).click();
  await page.getByTestId("reading-templates").waitFor();
};

(async () => {
  await test("1–4, 9. Excel real de Naturgy → proposta, graella, xat (fix) i desar la plantilla", async (page, s) => {
    await openTemplates(page);
    await page.getByLabel("Nom de la plantilla").fill("Captación PYMES Excel");
    await dropFile(page, page.getByRole("button", { name: /Arrossega l'Excel de mostra/ }), "NC-Productos-Captacion-PYMES-20261029-VP.xlsx", SAMPLE, XMIME);
    await page.getByTestId("template-editor").waitFor();
    await page.getByTestId("xlsx-grid").getByText("PLAN FIJO LUZ 24h (E0008)").waitFor();
    await page.getByTestId("products-preview").getByText(/61 productes · 4 serveis/).waitFor();
    await page.getByTestId("checks").getByText(/Pendents: PLAN VARIABLE LUZ \(E0013\), PLAN VARIABLE GAS \(G0009\)/).waitFor();
    // xat: «Aquest producte és fix…»
    await page.getByLabel("Bloc").selectOption({ label: "PLAN VARIABLE LUZ (E0013)" });
    await page.getByLabel("Missatge d'ensenyament").fill("Aquest producte és fix, encara que tingui sis períodes");
    await page.getByLabel("Missatge d'ensenyament").press("Enter");
    await page.getByTestId("teach-chat").getByRole("button", { name: "Aplica a la previsualització" }).click();
    await page.getByTestId("pending-ops").getByText(/9 files afectades/).waitFor();
    await page.getByLabel("Bloc").selectOption({ label: "PLAN VARIABLE GAS (G0009)" });
    await page.getByTestId("block-panel").getByLabel("Tipus de tarifa").selectOption("fixa");
    await page.getByTestId("checks").getByText("Tots els blocs classificats").waitFor();
    if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2, fullPage: true });
    await page.getByRole("button", { name: "Desa la plantilla" }).click();
    await page.getByTestId("reading-templates").waitFor();
    const c = s.posts.find((x) => x.action === "create");
    assert.equal(c.data.supplier, "Naturgy");
    assert.deepEqual(c.data.definition.blocks.filter((b) => /VARIABLE/.test(b.title)).map((b) => b.classification), ["fixa", "fixa"]);
    assert.ok(c.data.sample.sheets[0].name === "OCT26_3_VP", "es desa l'exemple documental");
    await page.getByTestId("tpl-status").getByText("PENDENT DE VERIFICACIÓ").waitFor();
  });

  await test("Panell: Direcció verifica la plantilla", async (page, s) => {
    await openTemplates(page);
    await page.getByTestId("tpl-status").getByText("PENDENT DE VERIFICACIÓ").waitFor();
    await page.getByRole("button", { name: "Verificar" }).click();
    await page.getByTestId("tpl-status").getByText("VERIFICADA").waitFor();
    assert.ok(s.posts.some((x) => x.action === "verify" && x.data.version === 2));
  }, { status: "pendent" });

  await test("7, 13. Segon Excel equivalent: canvis de preus i importació en esborrany (es conserven les versions)", async (page, s) => {
    await openTemplates(page);
    await page.getByRole("button", { name: /Provar amb un document/ }).click();
    await dropFile(page, page.getByTestId("test-document").getByRole("button", { name: /Arrossega l'Excel nou/ }), "NC-Productos-Captacion-PYMES-20261128-VP.xlsx", NEXT, XMIME);
    await page.getByTestId("read-diff").getByText(/Plan Fijo Luz 3\.0 · M: energia P1 0,2765 → 0,2801/).waitFor();
    await page.getByTestId("read-diff").getByText(/Vigència: OCT 2026 · versió 3 → NOV 2026 · versió 1/).waitFor();
    await page.getByRole("button", { name: /Aprova i importa al catàleg/ }).click();
    await page.getByText(/desades al catàleg com a ESBORRANY/).waitFor();
    const imp = s.imports[0];
    assert.equal(imp.offers.length, 61);
    assert.ok(imp.offers.every((o) => o.status === "esborrany" && o.template?.templateId === "tpl-naturgy"));
    assert.equal(imp.activateComplete, false);
    assert.ok(s.posts.some((x) => x.action === "read" && x.data.result.compatibility.status === "compatible"));
  }, { status: "verificada" });

  await test("8. Format canviat: no s'aplica la plantilla i es demana revisió", async (page, s) => {
    await openTemplates(page);
    await page.getByRole("button", { name: /Provar amb un document/ }).click();
    await dropFile(page, page.getByTestId("test-document").getByRole("button", { name: /Arrossega l'Excel nou/ }), "NC-format-canviat.xlsx", BAD, XMIME);
    await page.getByTestId("format-changed").getByText("S'ha detectat un canvi en el format de les tarifes. Cal revisar la plantilla de lectura.").waitFor();
    await page.getByTestId("format-changed").getByText(/L16/).waitFor();
    assert.ok(s.posts.some((x) => x.action === "read" && x.data.result.compatibility.status === "incompatible"));
    assert.equal(s.imports.length, 0);
  }, { status: "verificada" });

  // Fase 14.1: amb una plantilla VERIFICADA compatible, el lector del catàleg llegeix el document sencer amb les regles
  // d'aquella plantilla (variants «Variable» ja confirmades com a fixes) i el mostra per revisar i desar.
  await test("2.5. Lector de tarifes: un Excel nou de Naturgy es llegeix amb la plantilla verificada (sense IA)", async (page) => {
    await page.goto(`${BASE}?v=tarifes`);
    await page.getByText("Llegir fitxer de tarifes", { exact: false }).first().click();
    await dropFile(page, page.getByRole("button", { name: /Arrossega aquí el fitxer de tarifes/ }), "NC-Productos-Captacion-PYMES-20261128-VP.xlsx", NEXT, XMIME);
    const k = page.getByTestId("document-reconegut");
    await k.getByText("verificada").waitFor();
    await k.getByText(/61 tarifes · sense IA/).waitFor();
  }, { status: "verificada" });

  await test("10–11. Comparador: fixa real de Naturgy vs indexada de prova amb tres escenaris i punt d'equilibri", async (page) => {
    await page.goto(`${BASE}?v=comparativa&contract=demo-1`);
    await page.getByRole("button", { name: /Completament manual/ }).click();
    const kwh = [4000, 5000, 3000, 3000, 2000, 11930];
    for (let i = 0; i < 6; i++) { const f = page.getByLabel(`Consum P${i + 1} (kWh)`); await f.fill(String(kwh[i])); await f.press("Tab"); }
    for (let i = 0; i < 6; i++) { const f = page.getByLabel(`Potència P${i + 1} (kW)`); await f.fill("40"); await f.press("Tab"); }
    await page.getByRole("button", { name: "Continua: tria les ofertes" }).click();
    await page.getByLabel(/Selecciona Plan Fijo Luz 3\.0 · M/).check();
    await page.getByLabel(/Selecciona Indexada de prova/).check();
    await page.getByRole("button", { name: "Veure la comparativa" }).click();
    await page.getByRole("button", { name: "Activa els escenaris de mercat" }).click();
    const all = page.getByLabel("Mercat a tots els períodes");
    await all.fill("80"); await all.press("Tab");
    const t = page.getByTestId("market-table");
    for (const x of ["Millor fixa", "Indexada — baixista", "Indexada — central", "Indexada — alcista"]) await t.getByText(x, { exact: false }).first().waitFor();
    await page.getByTestId("market-chart").locator("svg").first().waitFor();
    await page.getByText(/Punt d'equilibri:/).first().waitFor();
    await page.getByTestId("market-explain").waitFor();
    if (process.env.SHOT) await page.getByTestId("market-panel").screenshot({ path: process.env.SHOT });
  });

  console.log("\nPROVES PLANTILLES I COMPARADOR (navegador amb respostes simulades; Excel real de Naturgy)");
  for (const [n, r] of results) console.log(`${r === "OK" ? "✔" : "✘"} ${n} — ${r}`);
  process.exit(results.every(([, r]) => r === "OK") ? 0 : 1);
})();
