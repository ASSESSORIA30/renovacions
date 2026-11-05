/**
 * FASE 10.1 · Proves Playwright del lector de la Tarifa Open (PROVAT AMB SIMULACIÓ al navegador).
 * El PDF que s'arrossega és el REAL (tests/fixtures/endesa) i la resposta del lector és la que genera el lector
 * local amb aquest mateix PDF (npx tsx scripts/e2e-open-fixtures.ts). Les crides /api/** i Supabase són simulades.
 *   node e2e/mkseed.mjs && npx vite build -c demo/vite.e2e.config.ts
 *   (cd demo/dist-e2e && python3 -m http.server 4174 &) · node e2e/tarifes-open.e2e.cjs
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

const BASE = process.env.E2E_URL || "http://localhost:4174/";
const ROOT = path.resolve(__dirname, "..");
const OPEN30 = JSON.parse(fs.readFileSync(path.join(__dirname, "open-3.0TD.json"), "utf8"));
const PDF30 = fs.readFileSync(path.join(ROOT, "tests/fixtures/endesa/20261030_3.0TD_OPEN_07_V1.pdf"));

/** Sessió FICTÍCIA de Supabase Auth (galeta de @supabase/ssr) perquè el navegador pugui «pujar» el fitxer al mock. */
async function fakeSession(page) {
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: "u-admin", aud: "authenticated", role: "authenticated", email: "direccio@exemple.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const access = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: "u-admin", exp, aud: "authenticated", role: "authenticated" })}.sig`;
  const session = { access_token: access, refresh_token: "fictici", token_type: "bearer", expires_in: 3600, expires_at: exp, user };
  await page.context().addCookies([{ name: "sb-e2e-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: BASE }]);
}

async function setup(page, s) {
  await fakeSession(page);
  await page.route("https://e2e.invalid/**", (r) => {
    const u = r.request().url();
    if (u.includes("/auth/v1/user")) return r.fulfill({ json: { id: "u-admin", aud: "authenticated", email: "direccio@exemple.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
    if (u.includes("/storage/v1/object/")) { s.uploads.push(u); return r.fulfill({ json: { Key: "invoices/u-admin/tarifes.pdf", Id: "x" } }); }
    return r.abort();
  });
  await page.route("**/api/**", async (r) => {
    const req = r.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method();
    const json = (j, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(j) });
    const body = () => JSON.parse(req.postData() || "{}");
    if (p === "/api/tariffs/ai-read") { if (m === "GET") return json({ ai: false }); s.reads.push(body()); return json({ raw: null, kind: "Tarifa Open d'Endesa · lector local (sense IA)", open: OPEN30 }); }
    if (p === "/api/tariffs/open") {
      if (m === "GET") return json({ rules: s.rules, approved: {}, calendar: null, migrated: true });
      const b = body(); s.open.push(b);
      if (b.action === "propose") { const row = { id: `r${s.open.length}`, kind: "modalitat", supplier: "Endesa", product: "Open", access_tariff: "3.0TD", doc_version: "07 · V1", modality: b.data.modality, rule: b.data.rule, source: b.data.source, status: b.data.approve ? "aprovada" : "proposada", note: null, created_by_name: "Direcció Demo", decided_by_name: null, decided_at: null, created_at: new Date().toISOString() }; return json({ rule: row, approved: !!b.data.approve, summary: "ok" }); }
      return json({ error: "simulació: el xat respon amb el motor local del navegador" }, 503);
    }
    if (p === "/api/tariffs/import") { const b = body(); s.imports.push(b); return json({ runId: "x", saved: b.offers?.length ?? 0, activated: 0 }); }
    if (p === "/api/tariffs") return json({ versions: [], crm: [], migrated: true });
    return json({ error: "simulació: no implementat" }, 404);
  });
}

const results = [];
async function test(name, fn) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const s = { reads: [], open: [], imports: [], uploads: [], rules: [] };
  await setup(page, s);
  try { await fn(page, s); assert.deepEqual(errors, [], `errors JS: ${errors.join(" | ")}`); results.push([name, "OK"]); }
  catch (e) { results.push([name, `FALLA: ${e.message.split("\n")[0]}`]); await page.screenshot({ path: path.join(__dirname, `fail-open-${results.length}.png`) }).catch(() => undefined); }
  finally { await browser.close(); }
}
/** Arrossega i deixa anar un fitxer sobre un element (DataTransfer real del navegador). */
async function dropFile(page, locator, name, bytes, type) {
  const dt = await page.evaluateHandle(({ name, b64, type }) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const d = new DataTransfer(); d.items.add(new File([u], name, { type })); return d;
  }, { name, b64: Buffer.from(bytes).toString("base64"), type });
  await locator.dispatchEvent("dragenter", { dataTransfer: dt });
  await locator.dispatchEvent("dragover", { dataTransfer: dt });
  await locator.dispatchEvent("drop", { dataTransfer: dt });
}
const openReader = async (page) => {
  await page.goto(`${BASE}?v=tarifes`);
  await page.getByText("Llegir fitxer de tarifes", { exact: false }).first().click();
  const zone = page.getByRole("button", { name: /Arrossega aquí el fitxer de tarifes/ });
  await dropFile(page, zone, "20261030_3.0TD_OPEN_07_V1.pdf", PDF30, "application/pdf");
  await page.getByTestId("open-dual").waitFor();
};

(async () => {
  await test("1 i 9. Arrossegar el PDF real → vista doble amb el document original i la conversió P1–P6", async (page, s) => {
    await openReader(page);
    assert.equal(s.reads.length, 1);
    assert.ok(s.uploads.length === 1, "el PDF es puja a la carpeta privada");
    const left = page.getByRole("region", { name: "Tarifa original Endesa" });
    await left.locator("iframe[title='Document original']").waitFor();
    for (const t of ["0,183659 €/kWh", "0,233977 €/kWh", "15-30 kW", "2026-10-26 – 2026-10-30", "27 % sobre el preu base (inclou el 7 % general)", "De 8h a 24h todos los días del año."]) await left.getByText(t, { exact: false }).first().waitFor();
    await page.getByText("PREU ESTIMAT PER PONDERACIÓ HORÀRIA").first().waitFor();
    await page.getByText(/Aquest preu és una estimació calculada segons les hores Open i No Open/).waitFor();
  });

  await test("2–4. Any 2027 · Día: P6 = 0,215054 · tram per P6 = 60 kW · Noche amb discrepància", async (page) => {
    await openReader(page);
    await page.getByLabel("Període de referència").selectOption("2027");
    assert.equal(await page.getByTestId("preu-P1").innerText(), "0,183659");
    assert.equal(await page.getByTestId("preu-P6").innerText(), "0,215054");
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
    await page.getByLabel("Potència P6").fill("60");
    assert.equal(await page.getByLabel("Tram de preus").inputValue(), "2");
    assert.equal(await page.getByTestId("preu-P1").innerText(), "0,183294");
    await page.getByRole("tab", { name: /Noche/ }).click();
    await page.getByTestId("discrepancies").waitFor();
    await page.getByText(/P6: 2088 h Open \(regla\) vs 2920 h \(document\)/).waitFor();
    await page.getByLabel("Mostra les fórmules").check();
    await page.getByText(/\(2088 h × 0.095413 \+ 2592 h × 0.233512\) \/ 4680 h/).waitFor();
  });

  await test("5–6. Plana igual a tots els períodes · Laboral i Fin de Semana segons Direcció", async (page) => {
    await openReader(page);
    await page.getByRole("tab", { name: "Plana" }).click();
    for (let i = 1; i <= 6; i++) assert.equal(await page.getByTestId(`preu-P${i}`).innerText(), "0,196239");
    await page.getByRole("tab", { name: /Laboral/ }).click();
    assert.equal(await page.getByTestId("preu-P1").innerText(), "0,171080");
    assert.equal(await page.getByTestId("preu-P6").innerText(), "0,233977");
    await page.getByRole("tab", { name: /Fin de Semana/ }).click();
    assert.equal(await page.getByTestId("preu-P1").innerText(), "0,233977");
    assert.equal(await page.getByTestId("preu-P6").innerText(), "0,120762");
  });

  await test("10–11. Xat: explica el P6 de Día; una correcció es recalcula i es desa a la biblioteca", async (page, s) => {
    await openReader(page);
    await page.getByLabel("Període de referència").selectOption("2027");
    const chat = page.getByLabel("Missatge al xat");
    await chat.fill("Per què el P6 de la tarifa Día té aquest preu?");
    await chat.press("Enter");
    await page.getByTestId("open-chat").getByText(/Hores Open: 1760 h/).waitFor();
    await page.getByTestId("open-chat").getByText(/Fórmula: \(1760 × 0,183659 \+ 2920 × 0,233977\) \/ 4680/).waitFor();
    await chat.fill("La Noche és de 0 a 8 tots els dies");
    await chat.press("Enter");
    await page.getByRole("button", { name: "Recalcula els sis períodes" }).click();
    // ara Noche coincideix amb el document (sense discrepàncies) i P6 té 2920 h Open
    await page.getByRole("tab", { name: /Noche/, selected: true }).waitFor();
    assert.equal(await page.getByTestId("discrepancies").count(), 0);
    await page.getByRole("button", { name: /Aprova i desa a la biblioteca/ }).click();
    await page.getByText("Regla aprovada i desada a la biblioteca").waitFor();
    const p = s.open.find((x) => x.action === "propose");
    assert.deepEqual(p.data.rule, { mode: "horari", windows: [{ days: "tots", from: 0, to: 8 }] });
    assert.equal(p.data.modality, "nit");
    assert.equal(p.data.source, "xat");
    assert.equal(p.data.approve, true);
  });

  await test("Aprova i desa: 10 ofertes (5 modalitats × 2 trams) i les pendents de validar, en esborrany", async (page, s) => {
    await openReader(page);
    await page.getByRole("button", { name: /Aprova i desa les ofertes al catàleg/ }).click();
    await page.getByText(/ofertes Open desades/).waitFor();
    const all = s.imports.flatMap((x) => x.offers);
    assert.equal(all.length, 10);
    assert.ok(all.every((o) => o.open && o.open.estimated === true && o.discounts.length === 0));
    const pending = s.imports.find((x) => x.counts.pendents_validacio);
    assert.equal(pending.activateComplete, false);
    assert.ok(pending.offers.every((o) => ["nit", "cap_de_setmana"].includes(o.open.modality)));
  });

  await test("13. Drag & drop en altres pantalles d'adjunts (plantilla de comercialitzadores al Catàleg)", async (page) => {
    await page.goto(`${BASE}?v=tarifes`);
    await page.getByRole("tab", { name: /Importar Excel/ }).click();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Comercializadora", "Producto"], ["Fictícia", "Prova"]]), "Productos");
    const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const area = page.locator("[data-droparea]").first();
    await dropFile(page, area, "plantilla-ficticia.xlsx", bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await page.getByText("plantilla-ficticia.xlsx").waitFor();
  });

  console.log("\nPROVES LECTOR TARIFA OPEN (navegador amb respostes simulades; PDF real)");
  for (const [n, r] of results) console.log(`${r === "OK" ? "✔" : "✘"} ${n} — ${r}`);
  process.exit(results.every(([, r]) => r === "OK") ? 0 : 1);
})();
