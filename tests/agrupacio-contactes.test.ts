/**
 * AGRUPACIÓ DE RENOVACIONS PER CONTACTE · lògica pura (src/core/contact-groups.ts). Dades fictícies.
 * Cobreix les proves obligatòries 1–8, 11 (relació general), 14 (molts contractes) i 15 (sense duplicats).
 */
import { describe, expect, it } from "vitest";
import {
  buildContactGraph, buildGroupMessage, columnCounts, commFingerprint, holderKey, isGenericEmail, kanbanItems, normEmail, normPersonName, normPhone,
  relatedAlert, relatedContracts, relatedToContacts, renewalClusters, summarize, type ManualLink,
} from "../src/core/contact-groups";
import type { Contract, Status } from "../src/core/types";
import { mkContract } from "./helpers/contract";

const cols = (cs: Contract[]) => {
  const r: Record<Status, Contract[]> = { pendiente: [], contactado: [], renovado: [], no_renueva: [] };
  for (const c of cs) r[c.crm.status].push(c);
  return r;
};

describe("normalització", () => {
  it("telèfons: prefixos, espais i números falsos", () => {
    expect(normPhone("+34 600 11 22 33")).toBe("600112233");
    expect(normPhone("0034-600.11.22.33")).toBe("600112233");
    expect(normPhone("600112233")).toBe("600112233");
    expect(normPhone("+33 6 12 34 56 78")).toBe("33612345678");
    expect(normPhone("600000000")).toBeNull();
    expect(normPhone("12345")).toBeNull();
    expect(normPhone(null)).toBeNull();
  });
  it("correus: minúscules, etiquetes «+» i genèrics", () => {
    expect(normEmail("  Joan.Prova+renov@Exemple.CAT ")).toBe("joan.prova@exemple.cat");
    expect(normEmail("no-és-correu")).toBeNull();
    expect(isGenericEmail("info@exemple.cat")).toBe(true);
    expect(isGenericEmail("administracio@exemple.cat")).toBe(true);
    expect(isGenericEmail("comptabilitat2@exemple.cat")).toBe(true);
    expect(isGenericEmail("joan.prova@exemple.cat")).toBe(false);
  });
  it("noms: accents, ordre i partícules; noms d'empresa i noms curts no són fiables", () => {
    expect(normPersonName("Joan García i Puig")).toBe(normPersonName("PUIG, Joan Garcia"));
    expect(normPersonName("Joan")).toBeNull();
    expect(normPersonName("Finques Prova SL")).toBeNull();
    expect(normPersonName("Comunitat de Propietaris Carrer Major")).toBeNull();
  });
});

describe("Proves 1–5 · coincidències", () => {
  it("1 · mateix telèfon (formats diferents) → relacionats", () => {
    const a = mkContract({ telefono: "+34 611 22 33 44" }), b = mkContract({ telefono: "611223344" }), x = mkContract({ telefono: "622000111" });
    const g = buildContactGraph([a, b, x]);
    expect(g.componentOf.get(a.id)).toBe(g.componentOf.get(b.id));
    expect(g.componentOf.has(x.id)).toBe(false);
    expect(relatedContracts(g, a.id).map((r) => r.contractId)).toEqual([b.id]);
  });
  it("2 · mateix correu (majúscules) → relacionats; correu genèric → no s'agrupa", () => {
    const a = mkContract({ email: "Marta.Prova@exemple.cat" }), b = mkContract({ email: "marta.prova@exemple.cat" });
    const c = mkContract({ email: "info@empresa-a.cat" }), d = mkContract({ email: "info@empresa-a.cat" });
    const g = buildContactGraph([a, b, c, d]);
    expect(g.componentOf.get(a.id)).toBe(g.componentOf.get(b.id));
    expect(g.componentOf.has(c.id)).toBe(false);
  });
  it("3 · coincidència fiable de persona: telèfon + mateix nom → confirmada; només telèfon → probable", () => {
    const a = mkContract({ telefono: "633445566", representante: "Joan Prova Ficticia" });
    const b = mkContract({ telefono: "633445566", representante: "Ficticia, Joan Prova" });
    const c = mkContract({ telefono: "633445566" });
    const g = buildContactGraph([a, b, c]);
    const rel = relatedContracts(g, a.id);
    expect(rel.find((r) => r.contractId === b.id)!.level).toBe("confirmada");
    expect(rel.find((r) => r.contractId === c.id)!.level).toBe("probable");
  });
  it("4 · contactes diferents amb noms semblants o iguals sense cap altra dada → NO s'agrupen", () => {
    const a = mkContract({ representante: "Joan Garcia Prova", telefono: "644000001" });
    const b = mkContract({ representante: "Joan Garcia Proves", telefono: "644000002" }); // semblant
    const c = mkContract({ representante: "Joan Garcia Prova", telefono: "644000003" }); // igual, però cap dada en comú
    const g = buildContactGraph([a, b, c]);
    expect(g.componentOf.size).toBe(0);
    const rel = relatedContracts(g, a.id);
    expect(rel).toHaveLength(1);
    expect(rel[0]).toMatchObject({ contractId: c.id, level: "ambigua" }); // per revisar, no agrupat
  });
  it("5 · telèfon genèric (centraleta) compartit per persones diferents → ambigu, no agrupat", () => {
    const tel = "973000111";
    const a = mkContract({ telefono: tel, representante: "Anna Prova Primera" });
    const b = mkContract({ telefono: tel, representante: "Pere Prova Segon" });
    const c = mkContract({ telefono: tel, representante: "Laia Prova Tercera" });
    const g = buildContactGraph([a, b, c]);
    expect(g.componentOf.size).toBe(0);
    expect(g.sharedKeys.has(`tel:${tel}`)).toBe(true);
    expect(relatedContracts(g, a.id).every((r) => r.level === "ambigua")).toBe(true);
  });
  it("5b · telèfon compartit per molts titulars sense cap nom → genèric; el telèfon de l'assessoria s'ignora", () => {
    const tel = "973111222";
    const many = Array.from({ length: 7 }, (_, i) => mkContract({ telefono: tel, cif: `B0000000${i}` }));
    expect(buildContactGraph(many).componentOf.size).toBe(0);
    const own = [mkContract({ telefono: "973999888" }), mkContract({ telefono: "973999888" })];
    expect(buildContactGraph(own, { ownPhones: ["+34 973 99 98 88"] }).componentOf.size).toBe(0);
  });
  it("administrador de finques: un mateix nom i telèfon per a moltes comunitats → una sola persona", () => {
    const list = Array.from({ length: 8 }, (_, i) => mkContract({ telefono: "655443322", representante: "Marc Administrador Prova", cif: `H0000000${i}` }));
    const g = buildContactGraph(list);
    expect(new Set(list.map((c) => g.componentOf.get(c.id))).size).toBe(1);
  });
  it("Clients 360°: mateix identificador de contacte → confirmada encara que no hi hagi telèfon", () => {
    const a = mkContract(), b = mkContract();
    const g = buildContactGraph([a, b], { c360: { [a.id]: ["k1"], [b.id]: ["k1"] } });
    expect(relatedContracts(g, a.id)[0]).toMatchObject({ contractId: b.id, level: "confirmada", reasons: ["clients360"] });
  });
});

describe("unir i separar manualment", () => {
  it("separar trenca una coincidència automàtica; unir relaciona contractes sense dades en comú", () => {
    const a = mkContract({ telefono: "666777888" }), b = mkContract({ telefono: "666777888" }), c = mkContract();
    const links: ManualLink[] = [{ id: "l1", kind: "separar", contract_a: a.id, contract_b: b.id }, { id: "l2", kind: "unir", contract_a: a.id, contract_b: c.id }];
    const g = buildContactGraph([a, b, c], { links });
    expect(g.componentOf.get(a.id)).not.toBe(g.componentOf.get(b.id));
    expect(g.componentOf.get(a.id)).toBe(g.componentOf.get(c.id));
    expect(relatedContracts(g, a.id, links)).toEqual([expect.objectContaining({ contractId: c.id, level: "confirmada", reasons: ["manual"] })]);
  });
  it("una separació no es pot saltar per un camí indirecte", () => {
    const a = mkContract({ telefono: "611000001", email: "x.prova@exemple.cat" });
    const b = mkContract({ telefono: "611000001" });
    const c = mkContract({ email: "x.prova@exemple.cat" });
    const g = buildContactGraph([a, b, c], { links: [{ id: "s", kind: "separar", contract_a: b.id, contract_b: c.id }] });
    expect(g.componentOf.get(b.id) === g.componentOf.get(c.id) && g.componentOf.has(b.id)).toBe(false);
  });
  it("un enllaç amb un contracte no visible s'ignora (no en revela l'existència)", () => {
    const a = mkContract();
    const g = buildContactGraph([a], { links: [{ id: "x", kind: "unir", contract_a: a.id, contract_b: "ocult" }] });
    expect(relatedContracts(g, a.id)).toEqual([]);
  });
});

describe("Prova 6 · renovacions pròximes i llunyanes (finestra)", () => {
  const tel = "677889900";
  const a = mkContract({ telefono: tel, venc: "2026-12-01" });
  const b = mkContract({ telefono: tel, venc: "2026-12-20" });
  const c = mkContract({ telefono: tel, venc: "2027-01-05" });
  const far = mkContract({ telefono: tel, venc: "2027-09-01" });
  const g = buildContactGraph([a, b, c, far]);
  it("finestra de 30 dies: el primer i l'últim d'un grup mai se separen més de 30 dies", () => {
    const cl = renewalClusters(g, [a, b, c, far], 30);
    expect(cl).toHaveLength(1);
    expect(cl[0].contractIds).toEqual([a.id, b.id]); // c és a 35 dies del primer → queda fora
    for (const x of cl) expect((Date.parse(x.last!) - Date.parse(x.first!)) / 86400000).toBeLessThanOrEqual(30);
  });
  it("finestra de 45 dies inclou c; 7 dies no agrupa res; el venciment llunyà no s'hi afegeix mai", () => {
    expect(renewalClusters(g, [a, b, c, far], 45)[0].contractIds).toEqual([a.id, b.id, c.id]);
    expect(renewalClusters(g, [a, b, c, far], 7)).toHaveLength(0);
    for (const w of [7, 15, 30, 45, 60, 90]) expect(renewalClusters(g, [a, b, c, far], w).flatMap((x) => x.contractIds)).not.toContain(far.id);
  });
  it("la relació general sí que inclou el contracte llunyà (8.1)", () => {
    expect(relatedContracts(g, a.id).map((r) => r.contractId)).toEqual([b.id, c.id, far.id]);
  });
  it("l'identificador del grup és estable encara que canviï l'ordre d'entrada", () => {
    expect(renewalClusters(g, [far, c, b, a], 30)[0].id).toBe(renewalClusters(g, [a, b, c, far], 30)[0].id);
  });
});

describe("Proves 7–8 · titulars diferents i estats diferents", () => {
  const tel = "688990011";
  const a = mkContract({ telefono: tel, cif: "B11111111", cliente: "Comunitat Prova A", representante: "Marc Gestor Prova", venc: "2026-12-01", tipo: "luz" });
  const b = mkContract({ telefono: tel, cif: "H22222222", cliente: "Comunitat Prova B", representante: "Marc Gestor Prova", venc: "2026-12-10", tipo: "gas", status: "contactado" });
  const c = mkContract({ telefono: tel, cif: "B11111111", cliente: "Comunitat Prova A", venc: "2026-12-12", tipo: "luz" });
  const g = buildContactGraph([a, b, c]);
  it("7 · el contacte és compartit però els titulars es distingeixen", () => {
    const rel = relatedContracts(g, a.id);
    expect(rel.find((r) => r.contractId === b.id)!.sameHolder).toBe(false);
    expect(rel.find((r) => r.contractId === c.id)!.sameHolder).toBe(true);
    expect(holderKey(a)).toBe("cif:B11111111");
    expect(summarize([a, b, c]).holders).toBe(2);
  });
  it("8 · un grup amb estats diferents dona una targeta per columna amb els seus contractes", () => {
    const clusters = renewalClusters(g, [a, b, c], 30);
    const items = kanbanItems(cols([a, b, c]), clusters, g.byId);
    const pend = items.pendiente.find((i) => i.kind === "group")!;
    const cont = items.contactado.find((i) => i.kind === "group")!;
    expect(pend.kind === "group" && pend.contracts.map((x) => x.id)).toEqual([a.id, c.id]);
    expect(cont.kind === "group" && cont.contracts.map((x) => x.id)).toEqual([b.id]);
    expect(pend.kind === "group" && pend.all).toHaveLength(3);
    expect(columnCounts(items.pendiente)).toEqual({ cards: 1, contracts: 2, groups: 1 });
    const s = summarize([a, b, c]);
    expect(s).toMatchObject({ total: 3, luz: 2, gas: 1, first: "2026-12-01", last: "2026-12-12", statuses: { pendiente: 2, contactado: 1 }, contactName: "Marc Gestor Prova" });
  });
  it("els grups es recalculen quan un contracte canvia de columna (sense duplicar-lo)", () => {
    const moved = { ...a, crm: { ...a.crm, status: "contactado" as Status } };
    const list = [moved, b, c];
    const g2 = buildContactGraph(list);
    const items = kanbanItems(cols(list), renewalClusters(g2, list, 30), g2.byId);
    const ids = Object.values(items).flat().flatMap((i) => (i.kind === "group" ? i.contracts.map((x) => x.id) : [i.id]));
    expect(ids.sort()).toEqual([a.id, b.id, c.id].sort()); // cada contracte hi surt exactament una vegada
    const cont = items.contactado.find((i) => i.kind === "group")!;
    expect(cont.kind === "group" && cont.contracts.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe("8.5 · avís intel·ligent i 8.2 · Clients 360°", () => {
  it("avisa només si hi ha renovacions pròximes", () => {
    const tel = "699001122";
    const a = mkContract({ telefono: tel, venc: "2026-11-20" });
    const b = mkContract({ telefono: tel, venc: "2026-11-25" });
    const c = mkContract({ telefono: tel, venc: "2027-06-01" });
    const g = buildContactGraph([a, b, c]);
    const al = relatedAlert(relatedContracts(g, c.id), g.byId, 30, "2026-11-05")!;
    expect(al.text).toBe("Aquest contacte té 2 contractes més, dels quals 2 vencen durant els pròxims 30 dies.");
    const g2 = buildContactGraph([c, mkContract({ telefono: tel, venc: "2027-08-01" })]);
    expect(relatedAlert(relatedContracts(g2, c.id), g2.byId, 30, "2026-11-05")).toBeNull();
  });
  it("11 · des d'una fitxa de client es troben els contractes dels seus contactes (qualsevol data)", () => {
    const a = mkContract({ email: "nuria.prova@exemple.cat", venc: "2028-01-01" });
    const b = mkContract({ telefono: "612121212" });
    const g = buildContactGraph([a, b]);
    const r = relatedToContacts(g, [{ name: "Núria Prova", email: "NURIA.prova@exemple.cat", phone: null }]);
    expect(r.map((x) => x.contractId)).toEqual([a.id]);
  });
});

describe("Comunicació conjunta", () => {
  it("missatge únic amb les condicions de cada contracte, en català i castellà", () => {
    const a = mkContract({ cliente: "Comunitat Prova A", cups: "ES0021000000000000011AA", venc: "2026-12-01", tarifa: "2.0TD" });
    const b = mkContract({ cliente: "Comunitat Prova B", cups: "ES0021000000000000022AA", venc: "2026-12-10", tipo: "gas", tarifa: "RL1" });
    const m = buildGroupMessage({ contactName: "joan prova", contracts: [a, b], lang: "ca", channel: "whatsapp", company: "Assessoria 3.0", sender: "Comercial Prova", withProposals: true, extras: { [a.id]: { ahorro: 120 } } });
    expect(m.body).toMatch(/^Bon dia, Joan\. Hem detectat que tens 2 contractes pròxims a renovar/);
    expect(m.body).toContain("Comunitat Prova A — CUPS …0011AA (llum, 2.0TD");
    expect(m.body).toContain("estalvi estimat 120 €/any");
    expect(m.body).toContain("T'adjuntem les propostes corresponents.");
    const es = buildGroupMessage({ contactName: null, contracts: [a], lang: "es", channel: "email", company: "Assessoria 3.0", sender: "X", withProposals: false });
    expect(es.body).toMatch(/^Buenos días\. Hemos detectado que tienes 1 contrato próximo/);
    expect(es.subject).toBe("Renovación de 1 contrato — Assessoria 3.0");
  });
  it("l'empremta no depèn de l'ordre ni del format del destinatari", () => {
    expect(commFingerprint("whatsapp", "+34 600 11 22 33", ["b", "a"])).toBe(commFingerprint("whatsapp", "600112233", ["a", "b"]));
    expect(commFingerprint("email", "X@Y.cat", ["a"])).toBe("email|email:x@y.cat|a");
    expect(commFingerprint("email", "no", ["a"])).toBeNull();
  });
});

describe("Prova 14 · rendiment amb molts contractes", () => {
  it("10.000 contractes: graf, grups i targetes en menys d'un segon i sense duplicats", () => {
    const list: Contract[] = [];
    for (let i = 0; i < 10_000; i++) {
      const person = i % 3500; // ~2-3 contractes per persona
      list.push(mkContract({ id: `m${i}`, telefono: `6${String(10_000_000 + person).slice(-8)}`, email: i % 5 ? null : `persona${person}@exemple.cat`, representante: `Persona Prova${person} Ficticia`, venc: `2026-${String(11 + (i % 2)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, status: (["pendiente", "contactado"] as Status[])[i % 2] }));
    }
    const t0 = performance.now();
    const g = buildContactGraph(list);
    const clusters = renewalClusters(g, list, 30);
    const items = kanbanItems(cols(list), clusters, g.byId);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1500);
    const seen = Object.values(items).flat().flatMap((i) => (i.kind === "group" ? i.contracts.map((x) => x.id) : [i.id]));
    expect(seen.length).toBe(list.length);
    expect(new Set(seen).size).toBe(list.length);
    for (const cl of clusters) expect((Date.parse(cl.last!) - Date.parse(cl.first!)) / 86400000).toBeLessThanOrEqual(30);
  });
});
