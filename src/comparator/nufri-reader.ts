/**
 * LECTOR LOCAL DE NUFRI (determinista, sense IA ni OCR) · annexos «Tarifas y modelo de retribución» d'Energía Nufri SLU.
 *
 * Llegeix el text del PDF (capa de text) i en treu, amb la pàgina i la secció d'origen de cada dada:
 *  · Llum 2.0TD / 3.0TD: nivells d'energia (FUJI, GOLDEN, GALA, GALAXY, ROYAL G) amb la comissió €/MWh,
 *    preus per períodes i preu únic, files «30% descuento» (preus JA descomptats), marges de potència BOE…BOE+6
 *    amb els preus publicats (€/kW·dia), compensació d'excedents, taula indexada (CO → comissió), fórmula i K.
 *  · Gas: RL1–RL4 amb els rangs de consum, terme fix (la unitat només si el document la diu), preus fixos 12 mesos,
 *    constants C de la modalitat indexada (1,0379 × PVB + C) i la comissió comercial de cada nivell (CONFERENCE,
 *    BARLET, DEVOE, WILLIAM'S), per a la modalitat fixa i per a la indexada per separat.
 *  · Condicions comercials (validesa, límit de consum, clients nous, energia verda, SAS, Reserva Virtual, telemesura…).
 * Les comprovacions creuades (nombre de cel·les, 30 % = original × 0,7, ordre dels nivells) marquen el que no es pot
 * verificar: mai s'inventa una cel·la.
 */

export interface Origin { page: number; section: string }
export interface NufriLevel { id: string; label: string; eurMwh: number | null; energy: (number | null)[]; energy24h: number | null; origin: Origin }
export interface NufriVariant {
  id: string;
  label: string;
  single: boolean;
  /** % de descompte publicat (els preus de la variant JA el porten aplicat) */
  discountPct: number | null;
  levels: NufriLevel[];
  /** Variant sense descompte de la qual surt (per conservar el preu original) */
  baseOf: string | null;
}
export interface NufriMargin { id: string; label: string; eurKwYear: number; power: (number | null)[]; origin: Origin }
export interface NufriElecTable {
  tariff: "2.0TD" | "3.0TD";
  greenIncluded: boolean | null;
  variants: NufriVariant[];
  margins: NufriMargin[];
  surplus: { fixEurMwh: number | null; indexed: string | null; scope: string | null; origin: Origin | null };
}
export interface NufriIndexedElec {
  rows: { coEurMwh: number; commissionEurMwh: number | null; origin: Origin }[];
  formula: string | null;
  k: number | null;
  components: { code: string; description: string }[];
  greenNotes: string[];
  surplusIndexed: string | null;
}
export interface NufriGasLevel { id: string; label: string; fixed: number | null; fixedCommission: number | null; c: number | null; indexedCommission: number | null }
export interface NufriGasRow {
  tariff: string;
  minKwh: number;
  maxKwh: number;
  /** Terme fix tal com el publica el document. La unitat NOMÉS si el document la diu (si no, null: cal confirmar-la). */
  fixedTerm: { value: number; unit: string | null };
  levels: NufriGasLevel[];
  origin: Origin;
}
export interface NufriConditions {
  validFrom: string | null;
  /** «fins a la notificació d'un nou annex»: no és una data de caducitat ni una vigència garantida */
  validUntilNote: string | null;
  maxAnnualKwh: number | null;
  newClientsOnly: boolean;
  sasIncluded: boolean | null;
  reserveVirtual: { available: boolean; costInformed: boolean; note: string | null };
  nonTelemeteredOnly: boolean;
  customOffer: string | null;
  powerCommissionNote: string | null;
  texts: string[];
}
export interface NufriDoc {
  kind: "llum" | "gas";
  supplier: string;
  version: string | null;
  annexDate: string | null;
  conditionsVersion: string | null;
  elec: NufriElecTable[];
  indexed: NufriIndexedElec | null;
  gas: NufriGasRow[];
  gasIndexedFormula: { multiplier: number; index: string; text: string; pvbDefinition: string | null } | null;
  conditions: NufriConditions;
  /** Avisos de lectura (cel·les que no quadren, dades no informades…) */
  warnings: string[];
  /** Dades que necessiten aprovació abans d'activar (p. ex. unitat del terme fix del gas) */
  approvals: string[];
}

const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const prices = (s: string) => (s.match(/\d+,\d{3,6}/g) ?? []).map(num);
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
export const levelId = (label: string) => norm(label).replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
const LEVELS_ELEC = ["FUJI", "GOLDEN", "GALA", "GALAXY", "ROYAL G"];

/** És un annex de tarifes i retribució d'Energía Nufri? (pel contingut, no pel nom del fitxer) */
export function isNufriTariffDoc(text: string): boolean {
  const t = norm(text);
  return /NUFRI/.test(t) && /MODELO DE RETRIBUCI/.test(t) && (/PRECIO TERMINO ENERGIA/.test(t) || /PRECIO TERMINO VARIABLE/.test(t));
}

function header(text: string) {
  const m = /\b(G?RV)\.\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(text);
  const cv = /CONDICIONES GENERALES\s+Ver\.\s*([^\s]+)\s+y\s+CONDICIONES PARTICULARES\s+Ver\.\s*([^\s]+)/i.exec(text);
  return {
    version: m ? `${m[1]}. ${m[2]}.${m[3]}.${m[4]}` : null,
    annexDate: m ? `${m[4]}-${m[3]}-${m[2]}` : null,
    conditionsVersion: cv ? `CG ${cv[1]} · CP ${cv[2]}` : null,
  };
}

function conditionsOf(text: string, annexDate: string | null): NufriConditions {
  const flat = text.replace(/\s+/g, " ");
  const vol = /hasta\s+(\d+)\s*MWh\s+de\s+consumo\s+anual/i.exec(flat);
  const reserve = /Reserva Virtual\s+contratable mediante anexo/i.test(flat);
  const texts: string[] = [];
  for (const k of ["Validez", "Tarifas", "Aceptación", "Retribución", "Documentación original", "Regularización por abandono", "Activación programada"]) {
    const re = new RegExp(`${k}\\s*:\\s*(.+?)(?=\\s(?:Validez|Tarifas|Aceptación|Retribución|Documentación original|Regularización por abandono|Activación programada|PVB)\\s*:|$)`, "i");
    const m = re.exec(flat);
    if (m) texts.push(`${k}: ${m[1].trim().slice(0, 900)}`);
  }
  const pc = /(En caso de comisionado por t[ée]rmino de potencia[^.]+\.[^.]+\.)/i.exec(flat);
  const custom = /(en caso de tarifas RL\.?4 a partir de \d+\s*MWh de consumo anual, se debe solicitar oferta y comisi[oó]n personalizada)/i.exec(flat);
  return {
    validFrom: annexDate,
    validUntilNote: /hasta la notificaci[oó]n de emisi[oó]n de un nuevo Anexo/i.test(flat) ? "Fins a la notificació d'un annex nou (sense data de caducitat; no és una vigència garantida)" : null,
    maxAnnualKwh: vol ? Number(vol[1]) * 1000 : null,
    newClientsOnly: /(sin contrato vigente en Energ[ií]a Nufri|que no est[eé]n contratados con Energ[ií]a Nufri)/i.test(flat),
    sasIncluded: /no llevan incorporados el sobrecoste asociado al mecanismo de ajuste/i.test(flat) ? false : null,
    reserveVirtual: { available: reserve, costInformed: false, note: reserve ? "Reserva Virtual contractable mitjançant un annex propi: el document no n'indica el cost (no s'inclou)." : null },
    nonTelemeteredOnly: /Solo para puntos NO TELEMEDIDOS/i.test(flat),
    customOffer: custom ? custom[1] : null,
    powerCommissionNote: pc ? pc[1] : null,
    texts,
  };
}

export function parseNufriDoc(pages: string[]): NufriDoc {
  const text = pages.join("\n");
  const h = header(text);
  const warnings: string[] = [];
  const approvals: string[] = [];
  const isGas = /GAS NATURAL/.test(norm(text)) && /TERMINO VARIABLE/.test(norm(text));
  const doc: NufriDoc = { kind: isGas ? "gas" : "llum", supplier: "Nufri", ...h, elec: [], indexed: null, gas: [], gasIndexedFormula: null, conditions: conditionsOf(text, h.annexDate), warnings, approvals };
  if (!h.version) warnings.push("No s'ha trobat la versió de l'annex (RV./GRV. dd.mm.aaaa).");
  return isGas ? parseGas(pages, doc) : parseElec(pages, doc);
}

/* ------------------------------------------------------------------ electricitat */

function parseElec(pages: string[], doc: NufriDoc): NufriDoc {

  let t: NufriElecTable | null = null;
  let block: "energia" | "potencia" | "indexat" | "condicions" | null = null;
  let single = false;
  let lastLevel: NufriLevel | null = null;
  const indexed: NufriIndexedElec = { rows: [], formula: null, k: null, components: [], greenNotes: [], surplusIndexed: null };
  const variant = (single: boolean, discountPct: number | null) => {
    const id = `${single ? "u" : "p"}${discountPct ? `_d${discountPct}` : ""}`;
    let v = t!.variants.find((x) => x.id === id);
    if (!v) {
      const label = `${single ? "Un precio" : t!.tariff === "2.0TD" ? "Tres precios" : "Seis precios"}${discountPct ? ` · ${discountPct}% descuento` : ""}`;
      v = { id, label, single, discountPct, levels: [], baseOf: discountPct ? (single ? "u" : "p") : null };
      t!.variants.push(v);
    }
    return v;
  };
  pages.forEach((page, pi) => {
    const lines = page.split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const n = norm(l);
      const tm = /^(?:TARIFA DE ACCESO\s*)?([23])\.0\s*TD$/.exec(n);
      if (tm) { t = { tariff: `${tm[1]}.0TD` as "2.0TD" | "3.0TD", greenIncluded: null, variants: [], margins: [], surplus: { fixEurMwh: null, indexed: null, scope: null, origin: null } }; doc.elec.push(t); block = null; continue; }
      if (/^DETALLE FORMULA INDEXADO|^COMENTARIOS:?$/.test(n)) block = "condicions";
      const km = /^-?\s*K:\s*Otros costes asociados\s*([\d.,]+)/i.exec(l);
      if (km) { indexed.k = Number(km[1].replace(",", ".")); indexed.components.push({ code: "K", description: `Altres costos associats (coeficient, no és un import en €/kWh): ${km[1]}` }); continue; }
      const comp = /^-\s*([A-Za-z]{1,6}i?):\s*(.+)$/.exec(l);
      if (block === "condicions" && comp) { indexed.components.push({ code: comp[1], description: comp[2].replace(/\s*\*$/, "").trim() }); continue; }
      if (!t) continue;
      if (/INCLUYE ENERGIA 100% RENOVABLE/.test(n)) { t.greenIncluded = true; continue; }
      if (/^ESTOS PRECIOS NO INCLUYEN$/.test(n) || /NO INCLUYEN ENERGIA VERDE/.test(n)) { t.greenIncluded = false; continue; }
      if (/PRECIO TERMINO ENERGIA/.test(n)) { block = "energia"; single = false; continue; }
      if (/PRECIO TERMINO POTENCIA/.test(n)) { block = "potencia"; continue; }
      if (/^PRECIO INDEXADO/.test(n)) { block = "indexat"; continue; }
      if (block === "energia" && /^UN PRECIO$/.test(n)) { single = true; continue; }
      if (block === "energia" && /^(TRES|SEIS) PRECIOS$/.test(n)) { single = false; continue; }
      const fix = /^Fijo:\s*(\d+(?:,\d+)?)\s*€\/MWh/i.exec(l);
      if (fix) { t.surplus.fixEurMwh = num(fix[1]); t.surplus.origin = { page: pi + 1, section: `${t.tariff} · Compensació d'excedents` }; continue; }
      const idx = /^Indexado:\s*(.+)$/i.exec(l);
      if (idx) { t.surplus.indexed = `${idx[1]} ${/^€\/MWh$/.test(lines[i + 1] ?? "") ? "€/MWh" : ""}`.replace(/\s+/g, " ").trim(); continue; }
      if (/COMPENSACION POR EXCEDENTES/.test(n)) {
        const sc = /(DE HASTA|SUPERIORES A)\s+(\d+)\s*kW/i.exec(l);
        if (sc && !t.surplus.scope) t.surplus.scope = `${/HASTA/i.test(sc[1]) ? "Fins a" : "Més de"} ${sc[2]} kW de potència contractada`;
        const inl = /Indexado\s+(Precio OMIE\s*-\s*\d+\s*€\/MWh)/i.exec(l);
        if (inl) indexed.surplusIndexed = inl[1];
        continue;
      }
      if (block === "indexat") {
        const row = /^(\d{1,2})\s+(\d+,\d{2})(?:\s+(.*))?$/.exec(l);
        if (row) {
          indexed.rows.push({ coEurMwh: Number(row[1]), commissionEurMwh: num(row[2]), origin: { page: pi + 1, section: "Preu indexat (2.0TD - 3.0TD)" } });
          const rest = row[3] ?? "";
          if (/∑|Energ[ií]a en barras/i.test(rest)) indexed.formula = rest.trim();
          else if (/^[23]\.0TD:/.test(rest)) indexed.greenNotes.push(rest.trim());
          continue;
        }
        if (/∑|Energ[ií]a en barras h/i.test(l)) { indexed.formula = l.replace(/^.*?(∑|Energ)/, "$1").trim(); continue; }
        if (/^[23]\.0TD:/.test(l)) { indexed.greenNotes.push(l); continue; }
        continue;
      }
      if (block === "energia") {
        const only = /^(\d+(?:,\d+)?)\s*€\/MWh$/.exec(l);
        if (only && lastLevel && lastLevel.eurMwh == null) { lastLevel.eurMwh = num(only[1]); continue; }
        const m = /^([A-Za-zÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑ' ]*?)\s*(?:\((sin descuento|(\d+)\s*%\s*descuento)\))?\s+(?:(\d+(?:,\d+)?)\s*€\/MWh\s+)?((?:\d+,\d{4,6}\s*)+)$/i.exec(l);
        if (!m || /COMISI/i.test(m[1])) continue;
        const ps = prices(m[5]);
        const disc = m[3] ? Number(m[3]) : null;
        const v = variant(single, disc);
        const label = m[1].trim().toUpperCase();
        // la comissió és del NIVELL (la fila «30% descuento» no la repeteix al document)
        const known = t.variants.flatMap((x) => x.levels).find((x) => x.label === label && x.eurMwh != null)?.eurMwh ?? null;
        const lv: NufriLevel = { id: levelId(label), label, eurMwh: m[4] ? num(m[4]) : known, energy: single ? [ps[0]] : ps, energy24h: single ? ps[0] : null, origin: { page: pi + 1, section: `${t.tariff} · Preu terme d'energia · ${v.label}` } };
        v.levels.push(lv);
        lastLevel = lv;
        continue;
      }
      if (block === "potencia") {
        const m = /^(BOE(?:\s*\+\s*\d+)?)\s+(\d+(?:,\d+)?)\s*€\/kW\/A[ñn]o\s+((?:\d+,\d{4,6}\s*)+)$/i.exec(l);
        if (m) t.margins.push({ id: m[1].replace(/\s+/g, "").toUpperCase(), label: m[1].replace(/\s+/g, "").toUpperCase(), eurKwYear: num(m[2]), power: prices(m[3]), origin: { page: pi + 1, section: `${t.tariff} · Preu terme de potència` } });
      }
    }
  });
  if (indexed.rows.length || indexed.formula) doc.indexed = indexed;
  verifyElec(doc);
  return doc;
}

/** Comprovacions creuades: si no quadren, s'avisa (la cel·la no es dona per bona). */
function verifyElec(doc: NufriDoc) {
  const w = doc.warnings;
  for (const e of doc.elec) {
    const per = e.tariff === "2.0TD" ? { energy: 3, power: 2 } : { energy: 6, power: 6 };
    for (const v of e.variants) {
      if (v.levels.length !== LEVELS_ELEC.length) w.push(`${e.tariff} ${v.label}: s'esperaven ${LEVELS_ELEC.length} nivells i se n'han llegit ${v.levels.length}.`);
      for (const lv of v.levels) {
        if (!v.single && lv.energy.length !== per.energy) { w.push(`${e.tariff} ${v.label} · ${lv.label}: s'esperaven ${per.energy} preus d'energia i n'hi ha ${lv.energy.length}.`); lv.energy = Array(per.energy).fill(null); }
        if (v.single && lv.energy.length !== 1) w.push(`${e.tariff} ${v.label} · ${lv.label}: preu únic no llegible.`);
        if (lv.eurMwh == null) w.push(`${e.tariff} ${v.label} · ${lv.label}: comissió d'energia no llegida.`);
      }
      // el preu ha de pujar amb el nivell de comissió
      for (let i = 1; i < v.levels.length; i++) {
        const a = v.levels[i - 1].energy[0], b = v.levels[i].energy[0];
        if (a != null && b != null && b < a) w.push(`${e.tariff} ${v.label}: el preu de ${v.levels[i].label} és inferior al de ${v.levels[i - 1].label} (revisa l'ordre de les files).`);
      }
      // «30% descuento» = original × (1 − 30 %), arrodonit a 6 decimals (els preus publicats ja són finals)
      if (v.discountPct && v.baseOf) {
        const base = e.variants.find((x) => x.id === v.baseOf);
        for (const lv of v.levels) {
          const o = base?.levels.find((x) => x.id === lv.id);
          if (!o) { w.push(`${e.tariff} ${v.label} · ${lv.label}: no hi ha la fila sense descompte per verificar-la.`); continue; }
          lv.energy.forEach((p, k) => {
            const op = o.energy[k];
            if (p == null || op == null) return;
            if (Math.abs(op * (1 - v.discountPct! / 100) - p) > 0.0000015) w.push(`${e.tariff} ${v.label} · ${lv.label} P${k + 1}: ${p} no és el ${v.discountPct} % de descompte de ${op}.`);
          });
        }
      }
    }
    for (const m of e.margins) if (m.power.length !== per.power) { w.push(`${e.tariff} ${m.label}: s'esperaven ${per.power} preus de potència i n'hi ha ${m.power.length}.`); m.power = Array(per.power).fill(null); }
    for (let i = 1; i < e.margins.length; i++) e.margins[i].power.forEach((p, k) => { const a = e.margins[i - 1].power[k]; if (p != null && a != null && p <= a) w.push(`${e.tariff} ${e.margins[i].label} P${k + 1}: no és superior a ${e.margins[i - 1].label}.`); });
    if (!e.margins.length) w.push(`${e.tariff}: no s'ha trobat la taula de potència (BOE).`);
    if (e.surplus.fixEurMwh == null) w.push(`${e.tariff}: compensació d'excedents no informada.`);
  }
  if (doc.indexed) {
    if (doc.indexed.rows.some((r, i, a) => i > 0 && r.coEurMwh <= a[i - 1].coEurMwh)) w.push("Taula indexada: els valors de CO no són creixents (revisa la lectura).");
    if (!doc.indexed.formula) w.push("Taula indexada: no s'ha pogut llegir la fórmula.");
    if (doc.indexed.k == null) w.push("Fórmula indexada: no s'ha trobat el coeficient K.");
  }
}

/* ------------------------------------------------------------------ gas */

function parseGas(pages: string[], doc: NufriDoc): NufriDoc {
  const { warnings } = doc;
  const text = pages.join("\n");
  const flat = text.replace(/\s+/g, " ");
  // noms dels nivells: entre «MODALIDAD INDEXADA» i el primer «RL» (4 de la modalitat fixa + 4 de la indexada)
  const hm = /MODALIDAD INDEXADA\s+(.+?)\s+RL\.?\s*1\b/i.exec(flat);
  const tokens = (hm?.[1].match(/[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'’]+/g) ?? []).filter((x) => !/^(PRECIO|TERMINO|FIJO|VARIABLE|MESES|MODALIDAD)$/.test(norm(x)));
  const half = tokens.length / 2;
  const names = tokens.length >= 8 && tokens.slice(0, half).join() === tokens.slice(half).join() ? tokens.slice(0, half) : tokens.slice(0, 4);
  if (names.length !== 4) warnings.push("No s'han pogut identificar els 4 nivells de gas.");
  // unitat del terme fix: només si el document la indica a la capçalera
  const fu = /PRECIO TERMINO FIJO\s*\(([^)]+)\)/i.exec(flat);
  const fixedUnit = fu ? fu[1].trim() : null;
  pages.forEach((page, pi) => {
    const lines = page.split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const m = /RL\.?\s*(\d)\s+(\d+)\s*MWh\s+a\s+(\d+)\s*MWh\s+(\d+,\d+)\s+(.*)$/i.exec(lines[i]);
      if (!m) continue;
      const [fixPart, ...cParts] = m[5].split(/C\s*=\s*/);
      const fixed = prices(fixPart);
      const cs = cParts.map((x) => prices(x)[0] ?? null);
      const comLine = /Comisi[oó]n comercial/i.test(lines[i + 1] ?? "") ? lines[i + 1] : "";
      const com = (comLine.match(/(\d+(?:,\d+)?)\s*€\/MWh/g) ?? []).map((x) => num(x.replace(/\s*€\/MWh/, "")));
      const tariff = `RL.${m[1]}`;
      if (fixed.length !== 4) warnings.push(`${tariff}: s'esperaven 4 preus de la modalitat fixa i n'hi ha ${fixed.length}.`);
      if (cs.length !== 4) warnings.push(`${tariff}: s'esperaven 4 constants C de la modalitat indexada i n'hi ha ${cs.length}.`);
      if (com.length !== 8) warnings.push(`${tariff}: s'esperaven 8 comissions (4 fixa + 4 indexada) i n'hi ha ${com.length}.`);
      for (let k = 1; k < fixed.length; k++) if (fixed[k] < fixed[k - 1]) warnings.push(`${tariff}: el preu fix de ${names[k]} és inferior al de ${names[k - 1]}.`);
      doc.gas.push({
        tariff, minKwh: Number(m[2]) * 1000, maxKwh: Number(m[3]) * 1000, fixedTerm: { value: num(m[4]), unit: fixedUnit },
        levels: names.map((n, k) => ({
          id: levelId(n), label: n,
          fixed: fixed.length === 4 ? fixed[k] : null, fixedCommission: com.length === 8 ? com[k] : null,
          c: cs.length === 4 ? cs[k] : null, indexedCommission: com.length === 8 ? com[4 + k] : null,
        })),
        origin: { page: pi + 1, section: `Gas · ${tariff}` },
      });
    }
  });
  if (doc.gas.length !== 4) warnings.push(`S'esperaven RL1–RL4 i se n'han llegit ${doc.gas.length}.`);
  if (!fixedUnit) doc.approvals.push("Terme fix del gas: el document no n'indica la unitat. Cal confirmar-la (€/mes, €/any o €/dia) abans d'activar les tarifes.");
  const f = /F[OÓ]RMULA INDEXADO\s+(\d+,\d+)\s*x\s*(PVB)\s*\+\s*C/i.exec(flat);
  const pvb = /PVB:\s*(.+?)(?=$)/i.exec(flat);
  doc.gasIndexedFormula = f ? { multiplier: num(f[1]), index: f[2], text: `${f[1]} x ${f[2]} + C`, pvbDefinition: pvb ? pvb[1].trim().slice(0, 600) : null } : null;
  if (!f) warnings.push("No s'ha trobat la fórmula de la modalitat indexada de gas.");
  return doc;
}

/** Preu ESTIMAT de la modalitat indexada de gas (€/kWh) amb un PVB de referència en €/MWh. Mai és un preu contractual. */
export function nufriGasIndexedPrice(c: number, pvbEurMwh: number, multiplier = 1.0379): number {
  return Math.round(((multiplier * pvbEurMwh) / 1000 + c) * 1e6) / 1e6;
}

/** Còpia sense cap import de comissió (per a qui no té accés a les dades econòmiques). */
export function stripNufriCommissions(doc: NufriDoc): NufriDoc & { commissionsHidden: true } {
  const d = structuredClone(doc);
  for (const e of d.elec) for (const v of e.variants) for (const l of v.levels) l.eurMwh = null;
  // el marge BOE (€/kW·any) és el nom de la modalitat de preu publicada: es manté. La comissió de la taula indexada, no.
  if (d.indexed) d.indexed.rows = d.indexed.rows.map((r) => ({ ...r, commissionEurMwh: null }));
  for (const g of d.gas) for (const l of g.levels) { l.fixedCommission = null; l.indexedCommission = null; }
  d.warnings = d.warnings.filter((w) => !/comissi/i.test(w));
  return { ...d, commissionsHidden: true };
}
