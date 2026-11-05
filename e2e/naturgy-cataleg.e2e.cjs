/**
 * FASE 14.1 · Proves Playwright (PROVAT AMB SIMULACIÓ al navegador): l'Excel REAL de Naturgy al lector de tarifes del
 * catàleg, en les condicions que fallaven: sense cap plantilla desada (o amb l'API de plantilles sense migració) i
 * sense IA. Totes les respostes /api/** són simulades. No es toca cap servei real.
 *   node e2e/mkseed.mjs && npx vite build -c demo/vite.e2e.config.ts
 *   (cd demo/dist-e2e && python3 -m http.server 4174 &) · node e2e/naturgy-cataleg.e2e.cjs
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.E2E_URL || "http://localhost:4174/";
const ROOT = path.resolve(__dirname, "..");
const NAME = "NC-Productos-Captacion-PYMES-20261029-VP.xlsx";
const SAMPLE = fs.readFileSync(path.join(ROOT, "tests/fixtures/naturgy", NAME));
const XMIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function setup(page, s) {
  await page.route("https://e2e.invalid/**", (r) => r.abort());
  await page.route("**/api/**", async (r) => {
    const req = r.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method();
    const json = (j, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(j) });
    if (p === "/api/tariffs/reading-templates") return s.templatesDown ? json({ error: "Falta aplicar la migració 023" }, 409) : json({ templates: [], defs: [], migrated: true });
    if (p === "/api/tariffs/ai-read") { s.ai.push(m); return m === "GET" ? json({ ai: false }) : json({ error: "El document té massa tarifes per llegir-les d'un cop." }, 422); }
    if (p === "/api/tariffs/import") { const b = JSON.parse(req.postData() || "{}"); s.imports.push(b); return json({ runId: "x", saved: b.offers.length, activated: b.activateComplete ? b.offers.length - b.keepDraftIds.length : 0, rejected: 0 }); }
    if (p === "/api/tariffs") return json({ items: [], suppliers: [] });
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
  const s = { ai: [], imports: [], templatesDown: false, ...state };
  await setup(page, s);
  try { await fn(page, s); assert.deepEqual(errors, [], `errors JS: ${errors.join(" | ")}`); results.push([name, "OK"]); }
  catch (e) { results.push([name, `FALLA: ${e.message.split("\n")[0]}`]); await page.screenshot({ path: path.join(__dirname, `fail-naturgy-${results.length}.png`), fullPage: true }).catch(() => undefined); }
  finally { await browser.close(); }
}
const open = async (page) => {
  await page.goto(`${BASE}?v=tarifes`);
  await page.getByText("Llegir fitxer de tarifes", { exact: false }).first().click();
  await dropFile(page, page.getByRole("button", { name: /Arrossega aquí el fitxer de tarifes/ }), NAME, SAMPLE, XMIME);
  await page.getByTestId("document-reconegut").waitFor();
};

(async () => {
  await test("Naturgy sense plantilla ni IA: es llegeix sencer (61 tarifes, 7 famílies, serveis a part)", async (page, s) => {
    await open(page);
    const k = page.getByTestId("document-reconegut");
    await k.getByText("Naturgy", { exact: true }).waitFor();
    await k.getByText("Captación PYMES").waitFor();
    await k.getByText(/61 tarifes · sense IA · OCT 2026/).waitFor();
    for (const f of ["PLAN FIJO LUZ 24h (E0008)", "PLAN FIJO LUZ (E0009)", "PLAN FIJO LUZ ECO (E0010)", "PLAN VARIABLE LUZ (E0013)", "TEMPORADA/OBRA", "PLAN VARIABLE GAS (G0009)", "PLAN COMPROMISO GAS (G0007)"]) await k.getByText(f).first().waitFor();
    await k.getByText(/No publicat al document \(cel·les #N\/A\)/).waitFor();
    await k.getByText(/SVG GC Complet/).waitFor();
    await k.getByText(/Seguimiento info/).waitFor();
    await page.getByText(/61 tarifes llegides de/).waitFor();
    assert.equal(s.ai.filter((x) => x === "POST").length, 0, "no s'envia res a la IA");
    await page.getByText("massa tarifes").waitFor({ state: "detached", timeout: 500 }).catch(() => undefined);
    assert.equal(await page.getByText("massa tarifes").count(), 0);
    if (process.env.SHOT1) await page.screenshot({ path: process.env.SHOT1 });
  });

  await test("Amb l'API de plantilles sense migració, també funciona", async (page, s) => {
    await open(page);
    await page.getByText(/61 tarifes llegides de/).waitFor();
    assert.equal(s.ai.filter((x) => x === "POST").length, 0);
  }, { templatesDown: true });

  await test("Confirmar «Variable» com a fixa i desar: s'activen les completes; les que tenen avisos o són incompletes queden en esborrany", async (page, s) => {
    await open(page);
    await page.getByLabel("Tipus de PLAN VARIABLE GAS (G0009)").selectOption("fixa");
    await page.getByLabel("Tipus de PLAN VARIABLE LUZ (E0013)").selectOption("fixa");
    await page.getByText("Nova: 54").waitFor();
    await page.getByText("Incompleta: 6").waitFor();
    await page.getByText(/Activa directament les completes/).click();
    if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2 });
    await page.getByRole("button", { name: /Desa \d+ tarifes al catàleg/ }).click();
    await page.getByText(/tarifes desades/).waitFor();
    const imp = s.imports[0];
    assert.equal(imp.activateComplete, true);
    assert.equal(imp.offers.length, 61);
    assert.equal(imp.keepDraftIds.length, 7, "1 per revisar + 6 incompletes queden en esborrany");
    const gas = imp.offers.find((o) => o.productName === "PLAN VARIABLE GAS MENSUAL · ONE" && o.accessTariff === "RL.1");
    assert.equal(gas.energy24h, 0.09793);
    assert.ok(Math.abs(gas.gasFixedEurDay - 0.0772908493150685) < 1e-15);
    assert.equal(gas.template.classification, "fixa");
    assert.equal(imp.mapping.lector, "integrat:Naturgy · Captación PYMES");
  });

  console.log("\nPROVES NATURGY AL CATÀLEG (navegador amb respostes simulades; Excel real de Naturgy)");
  for (const [n, r] of results) console.log(`${r === "OK" ? "✔" : "✘"} ${n} — ${r}`);
  process.exit(results.every(([, r]) => r === "OK") ? 0 : 1);
})();
