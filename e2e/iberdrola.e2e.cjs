/**
 * FASE 12 · Proves Playwright (PROVAT AMB SIMULACIÓ al navegador): lector universal amb l'Excel REAL d'Iberdrola
 * (pestanya «Energía»), xat, ensenyar amb un exemple, regla guardada i recuperada, document del mes següent, format
 * canviat, pestanya que falta, simulador de descomptes i lector de tarifes sense IA. Totes les respostes /api/** són
 * simulades (el servidor i Supabase NO es proven aquí); els Excel són el real i tres còpies modificades
 * (npx tsx scripts/e2e-iberdrola-fixtures.ts).
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.E2E_URL || "http://localhost:4174/";
const ROOT = path.resolve(__dirname, "..");
const F = (f) => fs.readFileSync(path.join(ROOT, "tests/fixtures/iberdrola", f));
const J = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "iberdrola", f), "utf8"));
const SAMPLE = F("IBERDROLA_HASTA_15.11.xlsx"), NEXT = F("IBERDROLA_HASTA_30.11.xlsx"), BAD = F("IBERDROLA_FORMAT_NOU.xlsx"), NOSHEET = F("IBERDROLA_SENSE_ENERGIA.xlsx");
const DEF = J("def.json"), GRID = J("grid.json"), READ = J("read.json"), CATALOG = J("catalog.json");
const XMIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const now = new Date().toISOString();

const retailer = { retailer: { id: "r-ib", trade_name: "Iberdrola", legal_name: null, tax_id: null, aliases: [], website: null, contact_name: null, phone: null, email: null, services: ["llum", "gas"], status: "activa", special_conditions: null, notes: null, logo_path: null, logoUrl: null }, documents: [], extractions: [], terms: [], rules: [], clawbacks: [], ai: { configured: false, policy: { enabled: false, dpa_reference: null, zero_retention: false, no_training: false, confirmed_by: null, confirmed_at: null, note: null } }, canEdit: true, canApprove: true, productContracts: null };
const tplRow = (s) => ({ id: "tpl-ib", retailer_id: "r-ib", supplier: "Iberdrola", name: "Hoja de Precios", doc_type: "xlsx", status: s.status, active: true, current_version: s.version, verified_version: null, verified_at: null, verified_by_name: null, last_read_at: null, last_read_status: null, last_errors: [], validated_pct: null, created_by_name: "Direcció Demo", created_at: now, updated_at: now });

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
        const def = { ...DEF, rules: s.rules };
        if (r0 === "get") return json({ template: tplRow(s), version: { version: s.version, definition: def, sample_name: "IBERDROLA_HASTA_15.11.xlsx", sample_grid: GRID, checks: [], note: null, created_by_name: "Direcció Demo", created_at: now }, versions: [], corrections: [], reads: [], library: s.library, examples: [], generalRules: [] });
        if (r0 === "previous") return json({ read: { id: "rd-1", file_name: "IBERDROLA_HASTA_15.11.xlsx", created_at: now, summary: READ } });
        return json({ templates: s.status ? [tplRow(s)] : [], defs: s.status ? [{ templateId: "tpl-ib", version: s.version, definition: def }] : [], generalRules: [], migrated: true });
      }
      const b = body(); s.posts.push(b);
      if (b.action === "create") { s.status = "pendent"; s.version = 1; return json({ template: tplRow(s), checks: [] }); }
      if (b.action === "learn") { s.version += 1; s.rules = [...s.rules, { ...b.data.rule, scope: b.data.scope, approved: true, approvedBy: "Direcció Demo" }]; s.library.push({ id: `lib-${s.posts.length}`, supplier: "Iberdrola", product: b.data.rule.id, rule: b.data.rule, source: b.data.rule.source, status: "aprovada", note: null, template_id: "tpl-ib", template_version: s.version, scope: b.data.scope, columns: b.data.rule.columns ?? null, example: null, created_by_name: "Direcció Demo", created_at: now, decided_by_name: "Direcció Demo", decided_at: now }); return json({ libraryId: "lib-1", status: "aprovada", version: s.version, approved: true }); }
      if (b.action === "read") return json({ id: `rd-${s.posts.length}`, status: b.data.result.compatibility.status });
      return json({ ok: true });
    }
    if (p === "/api/tariffs/import") { const b = body(); s.imports.push(b); return json({ runId: "x", saved: b.offers.length, activated: b.activateComplete ? b.offers.length : 0 }); }
    if (p === "/api/tariffs/ai-read") { s.aiCalls.push(m); return m === "GET" ? json({ ai: true }) : json({ error: "no s'hauria de cridar" }, 500); }
    if (p === "/api/tariffs") return json(CATALOG);
    return json({ error: "simulació: no implementat" }, 404);
  });
}
async function dropFile(page, locator, name, bytes, type) {
  const dt = await page.evaluateHandle(({ name, b64, type }) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const d = new DataTransfer(); d.items.add(new File([u], name, { type })); return d; }, { name, b64: bytes.toString("base64"), type });
  for (const ev of ["dragenter", "dragover", "drop"]) await locator.dispatchEvent(ev, { dataTransfer: dt });
}
const results = [];
async function test(name, fn, state = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const s = { status: null, version: 1, rules: [], library: [], posts: [], imports: [], aiCalls: [], ...state };
  await setup(page, s);
  try { await fn(page, s); assert.deepEqual(errors, [], `errors JS: ${errors.join(" | ")}`); results.push([name, "OK"]); }
  catch (e) { results.push([name, `FALLA: ${e.message.split("\n")[0]}`]); await page.screenshot({ path: path.join(__dirname, `fail-ib-${results.length}.png`), fullPage: true }).catch(() => undefined); }
  finally { await browser.close(); }
}
const openTemplates = async (page) => {
  await page.goto(`${BASE}?v=comercialitzadora&id=r-ib`);
  await page.getByRole("tab", { name: "Plantilles de lectura IA" }).click();
  await page.getByTestId("reading-templates").waitFor();
};
const openEditor = async (page) => {
  await openTemplates(page);
  await page.getByRole("button", { name: /Veure \/ editar amb el xat/ }).click();
  await page.getByTestId("table-reader").waitFor();
  await page.getByTestId("read-counts").waitFor();
};
const cell = (page, row, p) => page.getByTestId(`p${row}-e${p}`);

(async () => {
  await test("1–8. Excel real: pestanya «Energía» automàtica, totes les tarifes, descomptes de la columna O, P1–P6 finals i Plan OMIE com a marge", async (page, s) => {
    await openTemplates(page);
    await dropFile(page, page.getByRole("button", { name: /Arrossega l'Excel de mostra/ }), "IBERDROLA_HASTA_15.11.xlsx", SAMPLE, XMIME);
    await page.getByTestId("table-reader").waitFor();
    await page.getByTestId("sheet-picker").getByText("«Energía» detectada automàticament").waitFor();
    await page.getByTestId("sheet-picker").getByText(/Portada\(no s'utilitza\)/).waitFor();
    const c = page.getByTestId("read-counts");
    await c.getByText("100 identificades").waitFor();
    await c.getByText("65 interpretades").waitFor();
    await c.getByText(/0 fallides/).waitFor();
    for (const [i, v] of ["0,1504", "0,1504", "0,1504", "0,1504", "0,1504", "0,3096"].entries()) assert.match(await cell(page, 68, i + 1).innerText(), new RegExp(v));
    assert.match(await cell(page, 69, 6).innerText(), /0,136/);
    assert.match(await cell(page, 14, 1).innerText(), /0,1999/);
    await page.getByTestId("row-80").getByText(/Marge 0,027.*27 €\/MWh/).waitFor();
    await page.getByTestId("row-80").getByText("INDEXADA").waitFor();
    // detall: original conservat, descompte i horari
    await page.getByTestId("row-68").click();
    await page.getByTestId("row-detail").getByText(/I68 No Prom\. = 0,387/).waitFor();
    await page.getByTestId("row-detail").getByText(/08:00–17:00 de dilluns a divendres/).first().waitFor();
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: false });
    await page.getByRole("button", { name: "Desa la plantilla" }).click();
    await page.getByTestId("reading-templates").waitFor();
    const cr = s.posts.find((x) => x.action === "create");
    assert.equal(cr.data.definition.layout, "taula");
    assert.equal(cr.data.definition.table.sheetName, "Energía");
    assert.equal(cr.data.definition.knowledge, "iberdrola-energia");
    assert.ok(cr.data.sample.sheets.some((x) => x.name === "Energía"), "es desa l'exemple documental");
    assert.equal(s.aiCalls.filter((x) => x === "POST").length, 0, "cap crida a la IA");
  });

  await test("9–11. Xat: corregeix una tarifa, mostra l'abans/després i s'aplica només a aquest document", async (page) => {
    await openEditor(page);
    await page.getByTestId("row-72").click();
    await page.getByLabel("Missatge per a la IA").fill("P1–P5 promocionat i P6 no promocionat");
    await page.getByLabel("Missatge per a la IA").press("Enter");
    await page.getByTestId("rule-proposal").getByText(/1 tarifes canvien/).waitFor();
    await page.getByTestId("rule-proposal").getByText(/energia final/).waitFor();
    await page.getByRole("button", { name: "Aplica només a aquest document" }).click();
    await page.getByTestId("read-counts").getByText("66 interpretades").waitFor();
    assert.match(await cell(page, 72, 1).innerText(), /0,149/);
  }, { status: "pendent" });

  await test("8.4, 11. ENSENYAR A LA IA amb un exemple → regla guardada a Supabase (simulat) → es recupera en obrir de nou", async (page, s) => {
    await openEditor(page);
    await page.getByTestId("row-85").click();
    await page.getByTestId("teach-ai").click();
    const vals = ["0.128", "0.128", "0.128", "0.128", "0.128", "0.224"];
    for (let i = 0; i < 6; i++) await page.getByLabel(`P${i + 1} correcte`).fill(vals[i]);
    await page.getByLabel("Explicació").fill("Estancias Verdes 3.0TD: P1–P5 promocionat i P6 no promocionat, amb el 20 %");
    await page.getByRole("button", { name: "Compara amb la lectura" }).click();
    await page.getByTestId("example-result").getByText(/descompte base \(20 %/).waitFor();
    await page.getByRole("button", { name: /Revisa l'abans\/després i aprova/ }).click();
    await page.getByTestId("rule-proposal").getByText(/1 tarifes canvien/).waitFor();
    await page.getByRole("button", { name: "Guarda per a aquest producte" }).click();
    await page.getByTestId("teach-chat").getByText(/Regla guardada .* versió 3/).waitFor();
    const l = s.posts.find((x) => x.action === "learn");
    assert.deepEqual(l.data.rule.set.mapping, ["B", "B", "B", "B", "B", "A"]);
    assert.equal(l.data.scope, "producte");
    assert.deepEqual(l.data.example.expected, [0.128, 0.128, 0.128, 0.128, 0.128, 0.224]);
    // sessió nova: s'obre de nou i la regla es recupera de la versió desada
    await page.goto(`${BASE}?v=inici`);
    await openEditor(page);
    assert.match(await cell(page, 85, 6).innerText(), /0,224/);
    await page.getByTestId("read-counts").getByText("66 interpretades").waitFor();
  }, { status: "pendent", version: 2 });

  await test("12–15. Mes següent: plantilla recuperada, regla apresa aplicada, preus modificats i aprovació", async (page, s) => {
    await openTemplates(page);
    await page.getByRole("button", { name: /Provar amb un document/ }).click();
    await dropFile(page, page.getByTestId("test-document").getByRole("button", { name: /Arrossega l'Excel nou/ }), "IBERDROLA_HASTA_30.11.xlsx", NEXT, XMIME);
    await page.getByTestId("test-document").getByText(/Estructura compatible/).waitFor();
    const d = page.getByTestId("read-diff");
    await d.getByText(/Modificats: 4/).waitFor();
    await d.getByText(/3\.0TD Impulsa Negocios · Base: energia P2 0,188 → 0,185/).waitFor();
    await d.getByText(/3\.0TD Plan OMIE 1 · Base: .*marge 0,027 → 0,025/).waitFor();
    assert.match(await page.getByTestId("test-document").getByTestId("p85-e6").innerText(), /0,224/);
    await page.getByTestId("import-activate").click();
    await page.getByText(/aprovades i ACTIVES al comparador/).waitFor();
    assert.equal(s.imports.length, 2);
    assert.equal(s.imports[0].activateComplete, true);
    assert.ok(s.imports[0].offers.every((o) => o.template.interpStatus === "interpretada" && o.contractType !== "indexat"));
    assert.ok(s.imports[1].offers.every((o) => o.status === "esborrany"));
    assert.ok(s.imports[1].offers.some((o) => o.contractType === "indexat" && o.formula.marginEurMWh === 25));
  }, { status: "pendent", version: 3, rules: [{ id: "exemple:e2e", title: "3.0TD Estancias Verdes: P1–P5 Prom., P6 No Prom.", scope: "producte", match: { product: "3.0TD Estancias Verdes", tariffs: ["3.0TD"], priceCount: 2 }, set: { mapping: ["B", "B", "B", "B", "B", "A"] }, explanation: "e2e", source: "exemple", approved: true }] });

  await test("10. Format diferent: no s'aplica la plantilla antiga", async (page, s) => {
    await openTemplates(page);
    await page.getByRole("button", { name: /Provar amb un document/ }).click();
    await dropFile(page, page.getByTestId("test-document").getByRole("button", { name: /Arrossega l'Excel nou/ }), "IBERDROLA_FORMAT_NOU.xlsx", BAD, XMIME);
    await page.getByTestId("format-changed").getByText("S'ha detectat un canvi en el format de les tarifes. Cal revisar la plantilla de lectura.").waitFor();
    await page.getByTestId("format-changed").getByText(/O2.*descuento.*condiciones/).waitFor();
    assert.equal(s.imports.length, 0);
  }, { status: "pendent", version: 2 });

  await test("2. Sense pestanya «Energía»: error i selecció manual", async (page) => {
    await openTemplates(page);
    await page.getByRole("button", { name: /Provar amb un document/ }).click();
    await dropFile(page, page.getByTestId("test-document").getByRole("button", { name: /Arrossega l'Excel nou/ }), "IBERDROLA_SENSE_ENERGIA.xlsx", NOSHEET, XMIME);
    await page.getByTestId("missing-sheet").getByText(/No existeix la pestanya «Energía»/).waitFor();
    await page.getByRole("button", { name: "Llegeix «Precios»" }).click();
    await page.getByTestId("test-document").getByTestId("read-counts").getByText("100 identificades").waitFor();
  }, { status: "pendent", version: 2 });

  await test("7. SIMULAR DESCOMPTES: condicionat per consum (>40 MWh) i cost anual", async (page) => {
    await openEditor(page);
    await page.getByTestId("row-76").click();
    await page.getByTestId("row-detail").getByTestId("simulate-discounts").click();
    const sim = page.getByTestId("discount-simulator");
    await sim.getByText(/Consum anual superior a 40 MWh/).first().waitFor();
    await sim.getByLabel("Consum anual", { exact: true }).fill("30");
    await sim.getByText(/no supera 40 MWh/).waitFor();
    await sim.getByLabel("Consum anual", { exact: true }).fill("80");
    assert.match(await sim.getByTestId("sim-e1").innerText(), /0,259495/);
    for (let i = 0; i < 6; i++) await sim.getByLabel(`Consum P${i + 1}`).fill(i === 5 ? "30000" : "10000");
    for (let i = 0; i < 6; i++) await sim.getByLabel(`Potència P${i + 1}`).fill("40");
    await sim.getByTestId("sim-cost").getByText(/Estalvi net estimat/).waitFor();
    if (process.env.SHOT2) await sim.screenshot({ path: process.env.SHOT2 });
  }, { status: "pendent", version: 2 });

  await test("1. Lector de tarifes del catàleg: Iberdrola es llegeix amb el lector universal (sense enviar l'Excel a la IA)", async (page, s) => {
    await page.goto(`${BASE}?v=tarifes`);
    await page.getByText("Llegir fitxer de tarifes", { exact: false }).first().click();
    await dropFile(page, page.getByRole("button", { name: /Arrossega aquí el fitxer de tarifes/ }), "IBERDROLA_HASTA_15.11.xlsx", SAMPLE, XMIME);
    await page.getByTestId("table-reader").getByTestId("read-counts").getByText("100 identificades").waitFor();
    assert.equal(s.aiCalls.filter((x) => x === "POST").length, 0);
  });

  console.log("\nPROVES LECTOR UNIVERSAL · IBERDROLA (navegador amb respostes simulades; Excel real d'Iberdrola)");
  for (const [n, r] of results) console.log(`${r === "OK" ? "✔" : "✘"} ${n} — ${r}`);
  process.exit(results.every(([, r]) => r === "OK") ? 0 : 1);
})();
