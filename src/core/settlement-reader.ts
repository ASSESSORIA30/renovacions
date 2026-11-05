/**
 * FASE 14 · LECTOR MULTICOMERCIALITZADORA DE LIQUIDACIONS (lògica pura, sense servidor).
 *
 * Lectura determinista de TOTES les pestanyes d'un Excel/CSV de liquidació, amb coneixement validat per
 * comercialitzadora (Gana Energía, Niba) i un lector genèric per capçaleres per a la resta.
 *  - La fila «TOTAL» no és un moviment: se'n llegeix l'import per validar el subtotal de la pestanya.
 *  - Un import zero és un moviment documental vàlid (no genera cap cobrament).
 *  - Una mateixa columna pot voler dir coses diferents segons la pestanya: a «Clientes Activos» de Gana,
 *    «Retribución» és €/kWh, «KWh Activa» la quantitat i «Total» l'import (118 kWh × 0,01 = 1,18 €).
 *  - Les comissions negatives no s'eliminen ni es compensen: es classifiquen (retrocessió, regularització, baixa).
 *  - Imports amb aritmètica decimal (mai coma flotant). Res no s'inventa: un camp que no es pot llegir queda buit
 *    i la fila porta un avís perquè es revisi.
 *  - Alguns col·laboradors/distribuïdors fan servir UNA columna per al CUPS (llum i gas) i el TELÈFON (fibra i mòbil).
 *    Cada fila s'interpreta pel seu valor: un CUPS vàlid és un subministrament; un número de 9 xifres és una línia
 *    de telecomunicacions. Si la comissió porta l'IVA inclòs, la base és import / 1,21 (es conserva el brut).
 *  - Les cel·les de resum a la dreta de la taula (p. ex. «TOTAL IVA INCLUIDO») no són moviments: serveixen per quadrar.
 * El contingut del document és dada no fiable: només es llegeixen valors, mai instruccions.
 */
import { D, money } from "./commissions";

export type Cell = string | number | null;
export interface SheetGrid { name: string; rows: Cell[][] }
export interface WorkbookGrid { fileName: string; sheets: SheetGrid[] }

export type MovementType = "alta" | "renovacio" | "retrocessio" | "baixa" | "recurrent" | "regularitzacio" | "altres";
export const MOVEMENT_LABEL: Record<MovementType, string> = {
  alta: "Alta", renovacio: "Renovació", retrocessio: "Retrocomissió", baixa: "Baixa (retrocomissió)", recurrent: "Comissió recurrent (per consum)", regularitzacio: "Regularització", altres: "Altres",
};
/** Tipus de línia de fin_statement_lines (migració 011). */
export type LineKind = "comissio" | "retrocessio" | "ajustament" | "regularitzacio";
export type Energy = "llum" | "gas";

export interface Movement {
  sheet: string; row: number;                   // fila de l'Excel (1 = primera fila)
  cups: string | null; cupsRaw: string | null; concept: string;
  /** Línia de telecomunicacions (fibra o mòbil) quan la columna d'identificació porta un telèfon en lloc del CUPS. */
  phone: string | null;
  /** Import amb IVA tal com el porta el document (només si la columna és «IVA inclòs»). `amount` és sempre la base. */
  gross: string | null;
  movement: MovementType; kind: LineKind; energy: Energy | null;
  product: string | null; tariff: string | null; segment: string | null; user: string | null;
  dates: { created: string | null; alta: string | null; activation: string | null; baixa: string | null; invoice: string | null };
  /** Data rellevant del moviment (activació per a altes i renovacions, baixa per a retrocessions, factura per a recurrents). */
  eventDate: string | null;
  docStatus: string | null;
  amount: string;                               // import monetari del moviment, 2 decimals
  unit: { qty: string; price: string; unit: "kWh" } | null;
  flags: string[];                              // avisos de lectura o de la comercialitzadora
  stableKey: string;                            // identificador estable dins del document (pestanya + fila + camps)
}
export interface SheetSummary {
  name: string; role: "moviments" | "ignorada"; reason?: string;
  movement: MovementType | null; energy: Energy | null; headerRow: number | null;
  columns: Record<string, string>;              // camp → lletra de la columna
  count: number; total: string; declaredTotal: string | null; totalRow: number | null; balanced: boolean | null;
}
export interface ReadResult {
  supplier: { id: string; name: string; evidence: string } | null;
  format: "gana" | "niba" | "generic";
  signature: string;                            // empremta de l'estructura (pestanyes + capçaleres) per detectar canvis de format
  sheets: SheetSummary[]; movements: Movement[];
  total: string; byMovement: Record<MovementType, { count: number; total: string }>;
  errors: string[]; warnings: string[];
}

/* ======================================================================= utilitats */

const col = (i: number) => { let s = ""; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const txt = (c: Cell | undefined) => (c == null ? "" : String(c).trim());
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** CUPS normalitzat: sense espais ni signes, en majúscules. No es retalla cap sufix (0F, 1P…). */
export function normCups(v: Cell | undefined): string | null {
  const s = txt(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^ES\d{16}[A-Z]{2}(\d[A-Z])?$/.test(s) ? s : null;
}
/** Els 20 primers caràcters identifiquen el subministrament (el sufix 0F/1P és el punt frontera, opcional). */
export const cupsBase = (c: string | null | undefined) => (c && c.length >= 20 ? c.slice(0, 20) : c ?? null);

/** Import: accepta números, «1.234,56», «-12,5», «1,234.56», «(12,00)» i «100.0». Retorna text amb tota la precisió. */
export function parseDecimal(v: Cell | undefined): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? D(v).toString() : null;
  let s = txt(v).replace(/[€\s]/g, "");
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()+-]/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^\d+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return D(neg ? `-${s}` : s).toString();
}
/** Data: «DD-MM-AAAA», «DD/MM/AAAA», «AAAA-MM-DD» (també amb hora) o número de sèrie d'Excel. */
export function parseDate(v: Cell | undefined): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const s = txt(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}
function valid(y: number, mo: number, d: number) {
  const x = new Date(Date.UTC(y, mo - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === mo - 1 && x.getUTCDate() === d ? x.toISOString().slice(0, 10) : null;
}
const VAT_DIVISOR = "1.21";
/** Telèfon espanyol de 9 xifres (fix o mòbil), amb o sense prefix +34 / 0034. */
export function phoneOf(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/[\s.\-()]/g, "").replace(/^(\+34|0034)/, "");
  return /^[6789]\d{8}$/.test(d) ? d : null;
}
const isTotalRow = (row: Cell[]) => row.some((c) => /^total(es)?\b/i.test(txt(c))) && !row.some((c) => normCups(c));
const isEmpty = (row: Cell[]) => row.every((c) => txt(c) === "");
const energyOf = (s: string): Energy | null => (/\b(gas|rl\.?\d)\b/i.test(s) ? "gas" : /\b(luz|llum|electricidad|electricitat|2\.0td|3\.0td|6\.\dtd)\b/i.test(s) ? "llum" : null);

/** Empremta curta i estable (no criptogràfica): per a claus de moviment i signatures de format. */
export function fnv(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return ((h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0"));
}

/* ======================================================================= capçaleres */

type Field = "ident" | "amountVat" | "user" | "created" | "alta" | "baixa" | "activation" | "status" | "cups" | "segment" | "tariff" | "annual" | "amount" | "unitPrice" | "qty" | "total" | "invoice" | "type" | "product" | "line" | "concept" | "client" | "ref";
const HEADERS: [Field, RegExp][] = [
  ["user", /^(usuario|usuari|agente|comercial)$/],
  ["created", /^((fecha|data) (de )?(creacion|creacio)|tramitacion|tramitacio|fecha tramitacion)$/],
  ["alta", /^(fecha|data) (de )?alta$/],
  ["baixa", /^(f\.?|fecha|data) (de )?(baja|baixa)$/],
  ["activation", /^(f\.?|fecha|data|mes) (de )?(activacion|activacio)$/],
  ["invoice", /^(fecha|data) (de )?(factura)$/],
  ["status", /^(estado|estat|situacion|activado|activat)$/],
  ["cups", /^(cups|cups\/concepto|codigo cups|codi cups)$/],
  ["ident", /^(telefono|telefon|cups ?\/ ?telefono|telefono ?\/ ?cups|cups o telefono|linea movil|n(um|º)?\.? (de )?linea)$/],
  ["amountVat", /^(comision|comisio|comissio|importe|import|total)( con| amb| \+)? iva( incluido| inclos| inclòs)?$|^(comision|importe) \(iva incluido\)$/],
  ["segment", /^(segmento|segment)$/],
  ["tariff", /^(tarifa|peaje|peatge|tarifa de acceso)$/],
  ["annual", /^(consumo anual|consum anual)$/],
  ["qty", /^(kwh activa|kwh|consumo|consum|energia activa)$/],
  ["total", /^(total|importe total|import total)$/],
  ["amount", /^(retribucion|retribucio|comision|comisio|comissio|importe|import|importe comision|amount)$/],
  ["type", /^(tipo|tipus|tipo de movimiento|accion|accio)$/],
  ["product", /^(producto|producte|tarifa comercial)$/],
  ["line", /^(linea|linia|suministro|energia|fibra ?\/ ?movil)$/],
  ["concept", /^(concepto|concepte|descripcion|descripcio)$/],
  ["client", /^(cliente|client|titular|razon social|nombre|nombre del cliente|nom del client)$/],
  ["ref", /^(referencia|ref\.?|n(um|º)?\.? ?(de )?contrato|contrato|id contrato)$/],
];
function headerMap(row: Cell[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  row.forEach((c, i) => {
    const h = fold(txt(c));
    if (!h) return;
    for (const [f, re] of HEADERS) if (re.test(h) && out[f] == null) { out[f] = i; break; }
  });
  return out;
}
/** Primera fila (de les 15 primeres) amb una columna d'identificació i una d'import. */
function findHeader(rows: Cell[][]): { at: number; map: Partial<Record<Field, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const m = headerMap(rows[r] ?? []);
    if ((m.cups != null || m.ref != null || m.ident != null) && (m.amount != null || m.total != null || m.amountVat != null)) return { at: r, map: m };
  }
  return null;
}

/* ======================================================================= coneixement per comercialitzadora */

interface SheetRule { movement: MovementType; energy: Energy | null; variable?: boolean }
/** Gana Energía: una pestanya per tipus de moviment i energia. */
function ganaSheet(name: string): SheetRule | null {
  const n = fold(name);
  const energy: Energy | null = /\bgas\b/.test(n) ? "gas" : /\bluz\b/.test(n) ? "llum" : null;
  if (/^retrocomision/.test(n)) return { movement: "retrocessio", energy };
  if (/^altas?\b/.test(n)) return { movement: "alta", energy };
  if (/^renovacion/.test(n)) return { movement: "renovacio", energy };
  if (/^clientes activos/.test(n)) return { movement: "recurrent", energy, variable: true };
  return null;
}
export function detectSupplier(wb: WorkbookGrid): { id: "gana" | "niba"; name: string; evidence: string } | null {
  const names = wb.sheets.map((s) => s.name);
  const file = fold(wb.fileName);
  const gana = names.filter((n) => ganaSheet(n)).length;
  if (/gana/.test(file) || gana >= 2) return { id: "gana", name: "Gana Energía", evidence: /gana/.test(file) ? "nom del fitxer" : `${gana} pestanyes amb el format de Gana (Altas, Retrocomisión, Renovaciones, Clientes Activos)` };
  const first = wb.sheets[0];
  const h = first ? findHeader(first.rows) : null;
  const hasNibaProduct = wb.sheets.some((s) => s.rows.some((r) => r.some((c) => /^niba\b/i.test(txt(c)))));
  if (/niba/.test(file) || (h && h.map.type != null && h.map.line != null && hasNibaProduct)) return { id: "niba", name: "Niba", evidence: /niba/.test(file) ? "nom del fitxer" : "columnes TIPO, LÍNEA i productes «niba …»" };
  return null;
}

/* ======================================================================= lectura */

const EMPTY_BY = (): ReadResult["byMovement"] => Object.fromEntries((Object.keys(MOVEMENT_LABEL) as MovementType[]).map((k) => [k, { count: 0, total: "0.00" }])) as ReadResult["byMovement"];

export function readSettlement(wb: WorkbookGrid): ReadResult {
  const supplier = detectSupplier(wb);
  const format: ReadResult["format"] = supplier?.id ?? "generic";
  const sheets: SheetSummary[] = [];
  const movements: Movement[] = [];
  const errors: string[] = [], warnings: string[] = [];
  const sigParts: string[] = [];

  for (const sh of wb.sheets) {
    const rows = sh.rows;
    const rule = format === "gana" ? ganaSheet(sh.name) : null;
    const head = findHeader(rows);
    sigParts.push(`${fold(sh.name).replace(/\d{4}/g, "#")}:${head ? rows[head.at].map((c) => fold(txt(c))).filter(Boolean).join(",") : "-"}`);
    const base: SheetSummary = { name: sh.name, role: "ignorada", movement: rule?.movement ?? null, energy: rule?.energy ?? null, headerRow: head ? head.at + 1 : null, columns: {}, count: 0, total: "0.00", declaredTotal: null, totalRow: null, balanced: null };
    if (!head) {
      const reason = rows.some((r) => !isEmpty(r)) ? "No té capçaleres d'identificació (CUPS o referència) i d'import." : "Pestanya buida.";
      sheets.push({ ...base, reason });
      if (format === "gana" && rule) errors.push(`Pestanya «${sh.name}»: no s'han trobat les capçaleres esperades de Gana. Possible canvi de format.`);
      continue;
    }
    if (format === "gana" && !rule) { sheets.push({ ...base, reason: "Pestanya desconeguda per al format de Gana: no s'importa sense revisió." }); warnings.push(`Pestanya «${sh.name}» desconeguda: no s'ha importat. Revisa si el format ha canviat.`); continue; }
    const m = head.map;
    for (const [f, i] of Object.entries(m)) base.columns[f] = col(i as number);
    // Amplada de la taula: les cel·les a la dreta de l'última capçalera són resums, no dades del moviment.
    const width = rows[head.at].reduce<number>((a, c, i) => (txt(c) ? i : a), 0) + 1;
    const side: { label: string; value: string }[] = [];
    for (let r = head.at + 1; r < rows.length; r++) {
      const extra = (rows[r] ?? []).slice(width);
      extra.forEach((c, i) => { const v = parseDecimal(extra[i + 1]); if (txt(c) && !/^-?[\d.,]+$/.test(txt(c)) && v != null) side.push({ label: txt(c), value: money(v) }); });
    }
    // Columna de l'import monetari: «Total» si hi ha retribució unitària i quantitat (comissió variable per kWh).
    const variable = m.total != null && m.qty != null && m.amount != null;
    if (rule?.variable && !variable) errors.push(`Pestanya «${sh.name}»: s'esperaven les columnes Retribución, KWh Activa i Total.`);
    const vatIncluded = m.amount == null && m.amountVat != null;
    const amountCol = variable ? m.total! : m.amount ?? (vatIncluded ? m.amountVat! : m.total!);
    let grossTotal = D(0);
    let total = D(0); let count = 0;
    for (let r = head.at + 1; r < rows.length; r++) {
      const row = (rows[r] ?? []).slice(0, width);
      if (isEmpty(row)) continue;
      if (isTotalRow(row)) {
        // l'import del TOTAL és a la columna de l'import (o a la cel·la numèrica de la dreta de «TOTAL»)
        const at = row.findIndex((c) => /^total/i.test(txt(c)));
        const v = parseDecimal(row[amountCol]) ?? parseDecimal(row[at + 1]);
        base.declaredTotal = v != null ? money(v) : null; base.totalRow = r + 1;
        continue;
      }
      const flags: string[] = [];
      const idCol = m.cups ?? m.ident;
      const idCell = idCol != null ? row[idCol] : null;
      const cupsRaw = idCol != null ? (typeof idCell === "number" ? String(Math.round(idCell)) : txt(idCell)) || null : null;
      const cups = normCups(cupsRaw);
      const phone = !cups ? phoneOf(cupsRaw) : null;
      if (cupsRaw && !cups && !phone) flags.push(`CUPS no vàlid o concepte sense CUPS: «${cupsRaw.slice(0, 40)}»`);
      let raw = parseDecimal(row[amountCol]);
      let gross: string | null = null;
      if (vatIncluded) {
        const t = txt(row[amountCol]);
        if (raw == null && /no comision|no comisiona|sin comision|no comissiona/i.test(fold(t))) { raw = "0"; flags.push(`La comercialitzadora indica «${t}»: import 0.`); }
        if (raw != null) { gross = money(raw); grossTotal = grossTotal.plus(gross); raw = money(D(raw).div(VAT_DIVISOR)); if (!D(gross).isZero()) flags.push(`Import amb IVA inclòs al document (${gross} €): base = ${gross} / 1,21.`); }
      }
      let amount: string;
      let unit: Movement["unit"] = null;
      if (variable) {
        const price = parseDecimal(row[m.amount!]), qty = parseDecimal(row[m.qty!]);
        if (price != null && qty != null) unit = { qty, price, unit: "kWh" };
        if (raw == null && unit) { amount = money(D(unit.qty).times(unit.price)); flags.push("Import calculat (kWh × €/kWh): el document no porta el total de la fila."); }
        else amount = raw != null ? money(raw) : "0.00";
        if (raw != null && unit && !D(money(D(unit.qty).times(unit.price))).minus(money(raw)).abs().lte("0.01")) flags.push(`El total (${money(raw)} €) no quadra amb kWh × €/kWh (${money(D(unit.qty).times(unit.price))} €).`);
      } else {
        if (raw == null) { if (cups || txt(row[m.type ?? -1])) { flags.push("Import il·legible: la fila queda pendent de revisió amb import 0."); amount = "0.00"; } else continue; }
        else amount = money(raw);
      }
      const status = m.status != null ? txt(row[m.status]) || null : null;
      const typeTxt = m.type != null ? txt(row[m.type]) : "";
      const lineTxt = m.line != null ? txt(row[m.line]) : "";
      let product = m.product != null ? txt(row[m.product]) || null : null;
      let tariff = m.tariff != null ? txt(row[m.tariff]) || null : null;
      const segment = m.segment != null ? txt(row[m.segment]) || null : null;
      // «TARIFA» de vegades és el producte comercial (FIBRA 1GB, OKLUZ 360), no el peatge d'accés
      if (tariff && !/^(\d\.\d ?td|rl\.?\d+)$/i.test(tariff)) { if (!product && !/^sin servicio$/i.test(tariff)) product = tariff; tariff = null; }
      const dates = {
        created: m.created != null ? parseDate(row[m.created]) : null, alta: m.alta != null ? parseDate(row[m.alta]) : null,
        activation: m.activation != null ? parseDate(row[m.activation]) : null, baixa: m.baixa != null ? parseDate(row[m.baixa]) : null,
        invoice: m.invoice != null ? parseDate(row[m.invoice]) : null,
      };
      const neg = D(amount).lt(0);
      // ---- tipus de moviment
      let movement: MovementType; let kind: LineKind;
      if (rule) movement = rule.movement;
      else if (typeTxt && /^(luz|llum|gas|porta|portabilidad|portabilitat|fibra|movil|mobil|adsl|migracion|nueva|nova)\b/i.test(fold(typeTxt))) movement = "alta";
      else if (typeTxt) movement = /^alta/i.test(typeTxt) ? "alta" : /^baja|^baixa/i.test(typeTxt) ? "baixa" : /renov/i.test(typeTxt) ? "renovacio" : /retro|decomis/i.test(typeTxt) ? "retrocessio" : /regulari/i.test(typeTxt) ? "regularitzacio" : "altres";
      else {
        const hint = fold(`${sh.name} ${m.concept != null ? txt(row[m.concept]) : ""}`);
        movement = /retro|decomis/.test(hint) ? "retrocessio" : /renov/.test(hint) ? "renovacio" : /regulari/.test(hint) ? "regularitzacio" : /baja|baixa/.test(hint) ? "baixa" : /alta/.test(hint) ? "alta" : neg ? "retrocessio" : "altres";
      }
      if (movement === "retrocessio" || movement === "baixa") { kind = neg || D(amount).isZero() ? "retrocessio" : "regularitzacio"; if (!neg && !D(amount).isZero()) flags.push("Import positiu en un moviment de retrocomissió: es tracta com a regularització pendent de revisar."); }
      else if (movement === "regularitzacio") kind = "regularitzacio";
      else if (neg) { kind = "regularitzacio"; flags.push(movement === "renovacio" ? "Renovació amb import negatiu: regularització vinculada a una renovació." : "Import negatiu en un moviment de comissió: regularització pendent de revisar."); }
      else kind = "comissio";
      if (movement === "altres") flags.push(`Tipus de moviment no reconegut${typeTxt ? ` («${typeTxt}»)` : ""}: cal revisar-lo.`);
      if (D(amount).isZero()) flags.push("Import zero: moviment documental vàlid, sense cobrament.");
      if (status && /ojo/i.test(status)) flags.push(`Avís de la comercialitzadora: «${status}» (possible baixa).`);
      if (status && /suspend/i.test(status)) flags.push(`Estat «${status}»: no implica que la comissió no s'hagi liquidat.`);
      if (status && m.status != null && /^(no|cn|pendiente|pendent)/i.test(fold(status)) && !/^si$|^sí$/i.test(status)) flags.push(`Estat d'activació «${status}»: cal revisar-lo.`);
      const energy = phone ? null : rule?.energy ?? energyOf(`${typeTxt} ${lineTxt} ${segment ?? ""} ${tariff ?? ""} ${product ?? ""}`);
      const eventDate = movement === "retrocessio" || movement === "baixa" ? dates.baixa ?? dates.activation : movement === "recurrent" ? dates.invoice ?? dates.activation : dates.activation ?? dates.alta;
      const telecom = phone ? ` ${/movil|mobil/i.test(fold(lineTxt)) ? "mòbil" : /fibra|adsl/i.test(fold(lineTxt)) ? "fibra" : "telecomunicacions"} · tel. ${phone}` : "";
      const concept = `${MOVEMENT_LABEL[movement]}${energy ? ` ${energy === "gas" ? "gas" : "llum"}` : telecom}${product ? ` · ${product}` : ""} · ${sh.name}`;
      count++; total = total.plus(amount);
      movements.push({
        sheet: sh.name, row: r + 1, cups, cupsRaw, phone, gross, concept, movement, kind, energy, product, tariff, segment,
        user: m.user != null ? txt(row[m.user]) || null : null, dates, eventDate, docStatus: status, amount, unit, flags,
        stableKey: fnv([format, sh.name, r + 1, cups ?? cupsRaw ?? "", movement, eventDate ?? "", amount].join("|")),
      });
    }
    base.role = "moviments"; base.count = count; base.total = money(total);
    if (vatIncluded) {
      // quadre amb el resum de la dreta («TOTAL IVA INCLUIDO»): es compara amb la suma dels imports bruts
      const declared = side.find((x) => /total iva inclu/i.test(fold(x.label)));
      if (declared && base.declaredTotal == null) { base.declaredTotal = money(D(declared.value).div(VAT_DIVISOR)); base.totalRow = null; }
      if (declared && !D(declared.value).minus(money(grossTotal)).abs().lte("0.01")) errors.push(`Pestanya «${sh.name}»: la suma amb IVA (${money(grossTotal)} €) no quadra amb el «${declared.label}» del document (${declared.value} €).`);
      warnings.push(`Pestanya «${sh.name}»: les comissions porten l'IVA inclòs. Total amb IVA ${money(grossTotal)} € → base ${base.total} €.`);
    }
    if (!rule) base.movement = null;
    if (base.declaredTotal != null) {
      base.balanced = D(base.declaredTotal).minus(base.total).abs().lte("0.01");
      if (!base.balanced) errors.push(`Pestanya «${sh.name}»: la suma dels moviments (${base.total} €) no quadra amb el TOTAL del document (${base.declaredTotal} €, fila ${base.totalRow}).`);
    }
    sheets.push(base);
  }
  if (!movements.length && !errors.length) errors.push("No s'ha trobat cap moviment amb import en cap pestanya.");
  const byMovement = EMPTY_BY();
  for (const mv of movements) { const b = byMovement[mv.movement]; b.count++; b.total = money(D(b.total).plus(mv.amount)); }
  const keys = new Map<string, number>();
  for (const mv of movements) keys.set(mv.stableKey, (keys.get(mv.stableKey) ?? 0) + 1);
  return {
    supplier, format, signature: fnv(sigParts.join("¦")), sheets, movements,
    total: money(movements.reduce((a, x) => a.plus(x.amount), D(0))), byMovement, errors, warnings,
  };
}

/**
 * Empremta per detectar el MATEIX moviment en una altra liquidació (duplicat), independent de la fila i de la pestanya.
 * Les renovacions es cobren cada any: la clau inclou l'any del període perquè la renovació de l'any següent no
 * es confongui amb un duplicat. Les recurrents porten la data de factura.
 */
export function movementFingerprint(retailer: string, m: Pick<Movement, "cups" | "cupsRaw" | "movement" | "eventDate" | "amount" | "product">, periodTo: string | null): string {
  const year = m.movement === "renovacio" ? (periodTo ?? "").slice(0, 4) : "";
  return [fold(retailer), cupsBase(m.cups) ?? fold(m.cupsRaw ?? ""), m.movement, m.eventDate ?? "", m.amount, fold(m.product ?? ""), year].join("|");
}

/* ======================================================================= de SheetJS a graella */

type XlsxLike = {
  read: (data: Uint8Array | Buffer, opts: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json: <T>(ws: unknown, opts: Record<string, unknown>) => T[] };
};
/** Converteix un Excel o CSV en graella de valors (dates com a AAAA-MM-DD). No executa fórmules ni macros. */
export function gridFromBytes(X: XlsxLike, bytes: Uint8Array | Buffer, fileName: string): WorkbookGrid {
  // CSV: es llegeix com a text (raw) perquè «120,50» no es converteixi en 12050; els imports els interpreta parseDecimal
  const csv = /\.(csv|txt)$/i.test(fileName);
  const wb = X.read(bytes, { type: "buffer", cellDates: !csv, cellFormula: false, cellHTML: false, ...(csv ? { raw: true } : {}) });
  return {
    fileName,
    sheets: wb.SheetNames.map((name) => {
      const rows = X.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
      return { name, rows: rows.map((r) => (r ?? []).map((c): Cell => (c instanceof Date ? isoLocal(c) : typeof c === "number" || typeof c === "string" ? c : c == null ? null : String(c)))) };
    }),
  };
}
const isoLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000 + 12 * 3_600_000).toISOString().slice(0, 10);
