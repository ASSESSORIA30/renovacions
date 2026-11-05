/**
 * FASE 14 · Proves Playwright (PROVAT AMB SIMULACIÓ al navegador): auditor de comissions, importació de la liquidació
 * de Gana (còpia anonimitzada) amb previsualització per pestanyes, reclamació agrupada i autorització obligatòria.
 * Totes les respostes /api/** són simulades (e2e/auditor/*.json, generats amb el lector i el motor reals:
 * npx tsx scripts/e2e-auditor-fixtures.ts). No es toca cap servei real.
 *   node e2e/mkseed.mjs && npx vite build -c demo/vite.e2e.config.ts
 *   (cd demo/dist-e2e && python3 -m http.server 4174 &) · node e2e/auditor.e2e.cjs
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.E2E_URL || "http://localhost:4174/";
const ROOT = path.resolve(__dirname, "..");
const GANA = fs.readFileSync(path.join(ROOT, "tests/fixtures/liquidacions/75368-anonim.xlsx"));
const PREVIEW = JSON.parse(fs.readFileSync(path.join(__dirname, "auditor/preview.json"), "utf8"));
const AUDIT = JSON.parse(fs.readFileSync(path.join(__dirname, "auditor/audit.json"), "utf8"));
const XMIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const now = new Date().toISOString();
const CLAIM = "00000000-0000-4000-8000-00000000c1a1";

const claimDetail = (s) => ({
  claim: { id: CLAIM, code: "REC-2026-0012", retailer: "Gana Energía", period_from: "2025-11-03", period_to: "2026-11-03", status: "esborrany", total_claimed: "115.00", total_recognized: "0.00", total_recovered: "0.00", items_count: 2, assigned_to: null, sent_at: null, response_due: null, created_at: now, contact_id: null, contact_name: "Dept. Liquidacions", contact_email: "liquidaciones@exemple.test", email_subject: "Reclamación de comisiones Gana Energía", email_body: "Buenos días:\n\nLes escribimos desde Assessoria 3.0…", sent_channel: null, lang: "es", parent_id: null, retailer_id: null, created_by: "u-adm", authorized_at: s.authorized ? now : null, authorized_by: s.authorized ? "u-dir" : null, authorization_note: s.authorized ? "Revisada" : null },
  items: [
    { id: "i1", kind: "pendent_liquidacio", client_name: "CLIENT FICTICI 2", cups: "ES0031000000000002AA", external_ref: null, contract_ref: null, client_id: null, expected_amount: "100.00", settled_amount: "0.00", claimed_amount: "100.00", recognized_amount: "0.00", recovered_amount: "0.00", reason_text: "Activat el 01/05/2026 i no liquidat: el termini de pagament de 60 dies va vèncer el 30/06/2026.", reason_source: "regla", status: "reclamada", rule_ref: { label: "Regla «Gana · alta» v1" } },
    { id: "i2", kind: "infraliquidacio", client_name: "CLIENT FICTICI 5", cups: "ES0031000000000005AA", external_ref: null, contract_ref: null, client_id: null, expected_amount: "100.00", settled_amount: "85.00", claimed_amount: "15.00", recognized_amount: "0.00", recovered_amount: "0.00", reason_text: "Liquidat 85,00 € quan la regla aprovada en preveu 100,00 € (diferència 15,00 €).", reason_source: "regla", status: "reclamada", rule_ref: { label: "Regla «Gana · alta» v1" } },
  ],
  events: [], reminders: [], recoveries: [], links: [], contacts: [], people: [{ id: "u-dir", name: "Direcció Demo", role: "admin" }, { id: "u-adm", name: "Administració Demo", role: "cap_administrativa" }], parent: null, children: [],
  permissions: { role: "staff", canEdit: true, canManage: true, transitions: ["pendent_enviament", "enviada"] },
});
const contractEcon = {
  contract: { id: "2", client_id: "cl-2", retailer: "Gana Energía", product: "Tarifa 24 horas", status: "actiu", start_date: "2026-05-01", end_date: null }, client: { id: "cl-2", name: "CLIENT FICTICI 2", origin: null },
  supply: { cups: "ES0031000000000002AA", annual_kwh: 3000, power_kw: [4.6, 4.6] }, expedient: null, economics: { segment: "residencial", product_modality: null, eligible_mwh: null, energy_increment_eur_kwh: null, power_increment_eur_kw_day: null, economic_months: 12, econ_status: "actiu", cancelled_at: null, cancel_reason: null, settlement_deferred_until: null },
  owner: null, collaborator: null, facts: { segment: "residencial", service: "llum_residencial", refDate: "2026-05-01", annualKwh: 3000, months: 12 }, calculations: [], ledger: [],
  summary: { provider: { estimated: "100.00", estimatedStatus: "calculat", accrued: "0.00", invoiced: "0.00", confirmed: "85.00", collected: "40.00", adjustments: "0.00" }, margin: { status: "real", value: "40.00", estimated: null, note: "" }, costs: "0.00" },
  payouts: { comercial: null, collaborador: null }, statementLines: [], costs: [], legacy: null, permissions: { staff: true, canManageRules: true },
  commissionHistory: {
    states: { prevista: { amount: "100.00", status: "calculat" }, liquidada: "85.00", regularitzacions: "0.00", cobrada: "40.00", reclamada: "15.00", recuperada: "0.00" },
    lines: [{ id: "l2", received_at: "2026-08-10", reference: "GANA-2026-08", retailer: "Gana Energía", origin: "75368.xlsx / Altas LUZ / fila 3", movement: "alta", concept: "Alta llum", doc_status: "Activo", kind: "comissio", amount: "85.00", expected: "100.00", difference: "-15.00", match_status: "conciliat", collected: "40.00", collected_at: "2026-09-01", claim: ["REC-2026-0012"] }],
    claims: [{ id: "i2", claim_id: CLAIM, code: "REC-2026-0012", claim_status: "esborrany", kind: "infraliquidacio", claimed: "15.00", recovered: "0.00", status: "reclamada" }],
  },
};

const linked = (n, status, amount = "100.00") => ({ ...unlinked(n, `ES00310000000000${String(n).padStart(2, "0")}AA`, "CUPS · Gana Energía"), contract_id: `k${n}`, contract_label: `CLIENT ${n} · Gana Energía`, match_status: status, amount, expected_amount: status === "diferencia" ? "100.00" : null, difference: status === "diferencia" ? "-15.00" : null, match_confidence: "inequivoca" });
const unlinked = (n, cups, reason) => ({ id: `l${n}`, line_no: n, cups, external_ref: null, client_name: null, concept: "Alta llum · Altas LUZ", amount: "100.00", kind: "comissio", contract_id: null, contract_label: null, expected_amount: null, difference: null, match_status: "no_identificat", note: null, collected: "0.00", source_sheet: "Altas LUZ", source_row: n + 1, movement: "alta", doc_status: "Activo", flags: [], match_confidence: "cap", match_reason: reason, match_candidates: [] });
async function setup(page, s) {
  await page.route("https://e2e.invalid/**", (r) => r.abort());
  await page.route("**/api/**", async (r) => {
    const req = r.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method();
    const json = (j, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(j) });
    const body = () => JSON.parse(req.postData() || "{}");
    if (p === "/api/finance") {
      if (m === "GET") {
        const q = u.searchParams.get("r");
        if (q === "audit") { s.auditQueries.push(Object.fromEntries(u.searchParams)); return json(AUDIT); }
        if (q === "statements") return json({ rows: s.statements });
        if (q === "statement") return json({ statement: { id: "st-1", retailer: "Gana Energía", reference: "75368", received_at: "2026-11-02", period_from: null, period_to: null, declared_total: null, status: "en_conciliacio", source: "fitxer", file_name: "75368.xlsx", lines: 86, total: "2011.25", conciliated: "0.00", collected: "0.00", issues: 0, net_settlement: true }, lines: s.lines ?? [], receipts: [] });
        if (q === "contract") return json(contractEcon);
        return json({ error: "simulació" }, 404);
      }
      const b = body(); s.posts.push(b);
      if (b.action === "statement_preview") return json(PREVIEW);
      if (b.action === "missing_contracts") return json({ retailer: "Gana Energía", reference: "75368", proposals: [{ cups: "ES0031000000000002AA", supplyId: "sp-2", clientId: "cl-2", client: "CLIENT FICTICI 2", energy: "luz", current: [{ id: "k-ib", retailer: "Iberdrola", status: "actiu", start_date: "2025-11-18", end_date: "2026-11-18" }], lines: [{ id: "l2", line_no: 2, movement: "alta", amount: "100.00", origin: "Altas LUZ · fila 3" }], status: "actiu", start: "2026-10-16", end: null, product: null }], notInCrm: [{ cups: "ES0021000000000001AA", lines: [1] }] });
      if (b.action === "create_missing_contracts") return json({ created: b.data.cups.length, failed: [], matched: {} });
      if (b.action === "statement_match") return json({ matched: { identificat: 1 } });
      if (b.action === "line_contract") return json({ contractId: "k-new" });
      if (b.action === "conciliate_all") return json({ conciliated: b.data.includeDifferences ? 3 : 2, amount: b.data.includeDifferences ? "285.00" : "200.00", skipped: {} });
      if (b.action === "statement_create") { s.statements.push({ id: "st-1", retailer: b.data.retailer, reference: b.data.reference, received_at: b.data.received_at, period_from: null, period_to: null, declared_total: null, status: "en_conciliacio", source: "fitxer", file_name: b.file.name, lines: 86, total: "2011.25", conciliated: "0.00", collected: "0.00", issues: 2 }); return json({ id: "st-1", lines: 86, total: "2011.25", warnings: [], matched: { identificat: 80, no_identificat: 4, pendent: 2 }, regularizations: 0 }); }
      return json({ ok: true });
    }
    if (p === "/api/crm/search") { const q = u.searchParams.get("q") || ""; return json({ results: /^ES/i.test(q) ? [] : [{ kind: "client", id: "cl-1", title: "CLIENT FICTICI 1", sub: "Lleida", status: "actiu" }] }); }
    if (p.startsWith("/api/crm/clients/")) return json({ contracts: [{ id: "k-ib1", retailer: "Iberdrola", product: "ESPECIAL", status: "actiu", start_date: "2025-11-18" }] });
    if (p === "/api/claims") {
      if (m === "GET") return u.searchParams.get("r") === "claim" ? json(claimDetail(s)) : json({ scope: "staff", retailers: [], rows: [], kpis: null, claims: [], terms: null, people: [], canEdit: true });
      const b = body(); s.claimPosts.push(b);
      if (b.action === "create") return json({ id: CLAIM, code: "REC-2026-0012", items: b.data.keys.length });
      if (b.action === "authorize") { s.authorized = !!b.data.authorize; return json({ ok: true }); }
      return json({ ok: true });
    }
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
  const s = { posts: [], claimPosts: [], statements: [], auditQueries: [], authorized: false, ...state };
  await setup(page, s);
  try { await fn(page, s); assert.deepEqual(errors, [], `errors JS: ${errors.join(" | ")}`); results.push([name, "OK"]); }
  catch (e) { results.push([name, `FALLA: ${e.message.split("\n")[0]}`]); await page.screenshot({ path: path.join(__dirname, `fail-auditor-${results.length}.png`), fullPage: true }).catch(() => undefined); }
  finally { await browser.close(); }
}

(async () => {
  await test("Importar la liquidació de Gana: 8 pestanyes que quadren, 86 moviments, 2.011,25 € nets", async (page, s) => {
    await page.goto(`${BASE}?v=conciliacio`);
    await page.getByRole("button", { name: /Nova liquidació rebuda/ }).click();
    await dropFile(page, page.getByRole("button", { name: /Tria la liquidació o arrossega-la/ }), "75368.xlsx", GANA, XMIME);
    const pv = page.getByTestId("previsualitzacio");
    await pv.getByText("Gana Energía").first().waitFor();
    await pv.getByText(/86/).first().waitFor();
    for (const sh of ["Altas LUZ", "Retrocomisión Alta GAS", "Renovaciones GAS", "Clientes Activos GAS"]) await pv.getByRole("cell", { name: sh, exact: true }).waitFor();
    assert.equal(await pv.locator("tbody tr").first().locator("svg").count(), 1, "la primera pestanya quadra");
    await pv.getByText(/Retrocomissió: 16/).waitFor();
    assert.equal(await page.getByLabel("Comercialitzadora *").inputValue(), "Gana Energía", "la comercialitzadora es proposa sola");
    if (process.env.SHOT1) await page.screenshot({ path: process.env.SHOT1 });
    await page.getByRole("button", { name: "Importa i concilia" }).click();
    await page.getByText(/86 moviments registrats/).waitFor();
    const c = s.posts.find((x) => x.action === "statement_create");
    assert.equal(c.data.retailer, "Gana Energía"); assert.equal(c.data.net_settlement, true); assert.equal(c.data.force, false); assert.equal(c.file.name, "75368.xlsx");
  });

  await test("Auditor: indicadors, set alertes, filtre i comissions amb els quatre estats", async (page) => {
    await page.goto(`${BASE}?v=auditor`);
    const k = page.getByTestId("kpis-auditor");
    for (const l of ["Prevista", "Liquidada", "Cobrada", "Reclamada", "Pendent de liquidar", "Pendent de cobrament", "Retrocomissions", "Sense contracte"]) await k.getByText(l, { exact: true }).waitFor();
    await page.getByRole("button", { name: /Comissió pendent de liquidar 2/ }).waitFor();
    await page.getByRole("button", { name: /Liquidació duplicada 1/ }).waitFor();
    await page.getByRole("button", { name: /Comissió liquidada per un import inferior 1/ }).click();
    const t = page.getByTestId("taula-comissions");
    await t.getByText("CLIENT FICTICI 5").waitFor();
    assert.equal(await t.locator("tbody tr").count(), 1, "el filtre deixa només la liquidada per sota");
    await t.getByText("Liquidada per sota").waitFor();
    await page.getByRole("button", { name: /^Totes$/ }).click();
    await t.getByText("Pendent de liquidar (termini vençut)").first().waitFor();
    await t.getByText("Renovació").first().waitFor();
    if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2, fullPage: true });
    await page.getByRole("button", { name: /Moviments a revisar/ }).click();
    await page.getByText(/75368\.xlsx \/ Altas LUZ \/ fila/).first().waitFor();
  });

  await test("Historial del contracte: prevista, liquidada, cobrada i reclamada per separat, amb l'origen", async (page) => {
    await page.goto(`${BASE}?v=auditor`);
    await page.getByTestId("taula-comissions").getByRole("button", { name: "Obre el contracte" }).first().click();
    const h = page.getByTestId("historial-comissions");
    await h.waitFor();
    for (const l of ["Prevista", "Liquidada", "Cobrada", "Reclamada", "Pendent de cobrament"]) await h.getByText(l, { exact: true }).waitFor();
    await h.getByText("75368.xlsx / Altas LUZ / fila 3").waitFor();
    await h.getByText("Liquidada, pendent de cobrament").waitFor();
    await h.getByText("REC-2026-0012").first().waitFor();
  });

  await test("Generar reclamació a comercialitzadora: totes les discrepàncies en una sola reclamació, sense enviar res", async (page, s) => {
    await page.goto(`${BASE}?v=auditor`);
    await page.getByRole("button", { name: "Generar reclamació a comercialitzadora" }).click();
    await page.getByText(/Totes les discrepàncies reclamables \(3\)/).waitFor();
    await page.getByRole("button", { name: /Prepara la reclamació/ }).click();
    await page.getByTestId("autoritzacio").getByText("Pendent de revisió i autorització.").waitFor();
    const c = s.claimPosts.find((x) => x.action === "create");
    assert.equal(c.data.retailer, "Gana Energía");
    assert.deepEqual([...c.data.keys].sort(), AUDIT.groups[0].claimable.map((x) => x.key).sort());
    assert.ok(await page.getByRole("button", { name: /Enviar…/ }).isDisabled(), "no es pot enviar sense autorització");
    assert.ok(await page.getByRole("button", { name: "Registrar enviament extern" }).isDisabled());
    assert.ok(!s.claimPosts.some((x) => x.action === "send"));
  });

  await test("Autoritzar la reclamació habilita l'enviament", async (page, s) => {
    await page.goto(`${BASE}?v=reclamacions&id=${CLAIM}`);
    await page.getByRole("button", { name: /Autoritza l'enviament/ }).click();
    await page.getByRole("button", { name: "Desa", exact: true }).click();
    await page.getByTestId("autoritzacio").getByText("Revisada i autoritzada").waitFor();
    assert.deepEqual(s.claimPosts.find((x) => x.action === "authorize").data.authorize, true);
    assert.ok(await page.getByRole("button", { name: /Enviar…/ }).isEnabled());
    if (process.env.SHOT3) await page.screenshot({ path: process.env.SHOT3 });
  });

  await test("Liquidació: crea els contractes que falten (CUPS al CRM amb una altra comercialitzadora)", async (page, s) => {
    await page.goto(`${BASE}?v=conciliacio`);
    await page.getByText("75368").first().click();
    const av = page.getByTestId("avis-contractes-que-falten");
    await av.getByText(/1 línies/).waitFor();
    await av.getByRole("button", { name: /Crea els contractes que falten/ }).click();
    const m = page.getByTestId("contractes-que-falten");
    await m.getByText("CLIENT FICTICI 2").waitFor();
    await m.getByText(/Iberdrola · actiu fins/).waitFor();
    await m.getByText(/1 CUPS no són al CRM/).waitFor();
    await page.getByRole("button", { name: /Crea 1 contractes i torna a identificar/ }).click();
    await page.getByText(/1 contractes creats/).waitFor();
    const c = s.posts.find((x) => x.action === "create_missing_contracts");
    assert.deepEqual(c.data, { cups: ["ES0031000000000002AA"], closePrevious: false, rematch: false });
    assert.ok(s.posts.some((x) => x.action === "statement_match"), "es torna a identificar al final");
  }, { statements: [{ id: "st-1", retailer: "Gana Energía", reference: "75368", received_at: "2026-11-02", period_from: null, period_to: null, declared_total: null, status: "en_conciliacio", source: "fitxer", file_name: "75368.xlsx", lines: 2, total: "200.00", conciliated: "0.00", collected: "0.00", issues: 2 }],
       lines: [unlinked(1, "ES0021000000000001AA", "Cap subministrament del CRM té el CUPS ES0021000000000001AA."), unlinked(2, "ES0031000000000002AA", "El CUPS és al CRM, però cap contracte és de Gana Energía (n'hi ha 1 d'altres comercialitzadores).")] });

  await test("Assigna: un CUPS que no és al CRM avisa; es busca el client pel nom i s'hi crea el contracte de Gana", async (page, s) => {
    await page.goto(`${BASE}?v=conciliacio`);
    await page.getByText("75368").first().click();
    await page.getByRole("button", { name: "Assigna" }).first().click();
    const d = page.getByTestId("assignar-linia");
    await d.getByText(/aquest punt de subministrament encara no és al CRM/).waitFor();
    await d.getByPlaceholder("Client, NIF o CUPS").fill("Client fictici");
    await d.getByRole("button", { name: /CLIENT FICTICI 1/ }).click();
    await d.getByText(/Iberdrola · ESPECIAL/).waitFor();
    await d.getByRole("button", { name: /Crea el contracte de Gana Energía amb el CUPS ES0021000000000001AA/ }).click();
    await page.getByText(/Contracte de Gana Energía creat/).waitFor();
    assert.deepEqual(s.posts.find((x) => x.action === "line_contract").data, { lineId: "l1", clientId: "cl-1" });
  }, { statements: [{ id: "st-1", retailer: "Gana Energía", reference: "75368", received_at: "2026-11-02", period_from: null, period_to: null, declared_total: null, status: "en_conciliacio", source: "fitxer", file_name: "75368.xlsx", lines: 1, total: "100.00", conciliated: "0.00", collected: "0.00", issues: 1 }],
       lines: [unlinked(1, "ES0021000000000001AA", "Cap subministrament del CRM té el CUPS ES0021000000000001AA.")] });

  await test("Concilia-ho tot: totes les identificades d'un clic; les de diferència només amb un motiu comú", async (page, s) => {
    await page.goto(`${BASE}?v=conciliacio`);
    await page.getByText("75368").first().click();
    await page.getByTestId("concilia-tot").getByText("Concilia-ho tot (3)").waitFor();
    await page.getByTestId("concilia-tot").click();
    const d = page.getByTestId("concilia-tot-dialeg");
    await d.getByText(/2 línies identificades/).waitFor();
    await d.getByText(/1 sense contracte o per triar/).waitFor();
    await d.getByText(/1 línies amb diferència/).click();
    const btn = page.getByRole("button", { name: "Concilia 3 línies" });
    assert.ok(await btn.isDisabled(), "cal el motiu de les diferències");
    await d.getByLabel(/Motiu/).fill("Revisat amb Gana");
    await btn.click();
    await page.getByText(/3 línies conciliades/).waitFor();
    assert.deepEqual(s.posts.find((x) => x.action === "conciliate_all").data, { includeDifferences: true, note: "Revisat amb Gana" });
  }, { statements: [{ id: "st-1", retailer: "Gana Energía", reference: "75368", received_at: "2026-11-02", period_from: null, period_to: null, declared_total: null, status: "en_conciliacio", source: "fitxer", file_name: "75368.xlsx", lines: 4, total: "385.00", conciliated: "0.00", collected: "0.00", issues: 1 }],
       lines: [linked(1, "identificat"), linked(2, "identificat"), linked(3, "diferencia", "85.00"), unlinked(4, "ES0021000000000004AA", "Cap subministrament del CRM té el CUPS ES0021000000000004AA.")] });

  console.log("\nPROVES AUDITOR DE COMISSIONS (navegador amb respostes simulades; Excel anonimitzat de Gana)");
  for (const [n, r] of results) console.log(`${r === "OK" ? "✔" : "✘"} ${n} — ${r}`);
  process.exit(results.every(([, r]) => r === "OK") ? 0 : 1);
})();
