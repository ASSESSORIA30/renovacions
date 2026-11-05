/** Centro de alertas: reglas deterministas, cada una con motivo, fuente (columna) y gravedad. */
import { annualActive, maxContracted, maxMonthlyDemand, sumKnown } from "./parse";
import { checkRules, controlMode, tariffRules } from "./tariffs";
import type { Supply } from "./types";

export type Severity = "critica" | "alta" | "media" | "baja" | "info";
export const SEVERITY_ORDER: Severity[] = ["critica", "alta", "media", "baja", "info"];
export const SEVERITY_LABEL: Record<Severity, string> = { critica: "Crítica", alta: "Alta", media: "Media", baja: "Baja", info: "Info" };

export type AlertCategory = "administrativa" | "tecnica" | "consumo" | "potencia" | "datos" | "oportunidad";

export interface Alert {
  id: string;
  cups: string;
  rule: string;
  category: AlertCategory;
  severity: Severity;
  title: string;
  reason: string;
  columns: string[];
  origin: string;
}

export interface AlertConfig {
  expiryWarnDays: number;
  readingStaleDays: number;
  readingVeryStaleDays: number;
  rightsWarnDays: number;
  oversizeUtilPct: number;
}
export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  expiryWarnDays: 90,
  readingStaleDays: 60,
  readingVeryStaleDays: 120,
  rightsWarnDays: 180,
  oversizeUtilPct: 50,
};

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

export function supplyAlerts(s: Supply, cfg: AlertConfig = DEFAULT_ALERT_CONFIG, today = new Date().toISOString().slice(0, 10)): Alert[] {
  const out: Alert[] = [];
  const origin = `${s.source.file} · fila ${s.source.row}${s.source.demo ? " · DEMO" : ""}`;
  const add = (rule: string, category: AlertCategory, severity: Severity, title: string, reason: string, columns: string[]) =>
    out.push({ id: `${s.cups}:${rule}`, cups: s.cups, rule, category, severity, title, reason, columns, origin });

  if (!s.cupsValid) add("cups", "datos", "alta", "CUPS no válido", s.cupsIssue ?? "Formato incorrecto", ["CUPS"]);

  for (const [k, label, col] of [
    ["bie", "BIE", "F. Caducidad BIE"],
    ["apm", "APM", "F. Caducidad APM"],
  ] as const) {
    const d = k === "bie" ? s.fCaducidadBIE : s.fCaducidadAPM;
    if (!d) continue;
    const left = days(today, d);
    if (left < 0) add(`${k}-caducado`, "administrativa", "critica", `${label} caducado`, `Caducó el ${d} (hace ${-left} días). Puede impedir modificaciones de potencia o cambios contractuales.`, [col]);
    else if (left <= cfg.expiryWarnDays) add(`${k}-proximo`, "administrativa", "alta", `${label} próximo a caducar`, `Caduca el ${d} (en ${left} días).`, [col]);
  }

  if (s.fLimiteDerechos) {
    const left = days(today, s.fLimiteDerechos);
    if (left >= 0 && left <= cfg.rightsWarnDays)
      add("derechos", "administrativa", "media", "Derechos reconocidos próximos a vencer", `Fecha límite ${s.fLimiteDerechos} (en ${left} días). Tras ella, recuperar potencia exigirá abonar derechos de acceso/extensión.`, ["F. Límite Derechos Reconocidos"]);
    else if (left < 0)
      add("derechos-vencidos", "administrativa", "info", "Derechos reconocidos vencidos", `Fecha límite ${s.fLimiteDerechos}. Ampliar potencia por encima de la contratada tendrá coste regulado.`, ["F. Límite Derechos Reconocidos"]);
  }

  if (s.contratable === false)
    add("no-contratable", "administrativa", "critica", "Suministro no contratable", s.motivoNoContratable ? `Motivo: ${s.motivoNoContratable}` : "El origen indica que no es contratable (sin motivo informado).", ["Contratable", "Motivo NO Contratable"]);

  if (s.impagos && !/^(no|n|0|sin|false|-)$/i.test(s.impagos.trim()))
    add("impagos", "administrativa", "alta", "Información de impagos presente", `Valor informado: "${s.impagos}". Revisar antes de ofertar.`, ["Informacion Impagos"]);

  if (s.fUltLectura) {
    const age = days(s.fUltLectura, today);
    if (age > cfg.readingVeryStaleDays) add("lectura", "datos", "alta", "Lectura muy antigua", `Última lectura ${s.fUltLectura} (${age} días). Los consumos pueden estar desactualizados.`, ["F. Últ. Lectura"]);
    else if (age > cfg.readingStaleDays) add("lectura", "datos", "media", "Lectura antigua", `Última lectura ${s.fUltLectura} (${age} días).`, ["F. Últ. Lectura"]);
  } else add("lectura-sd", "datos", "baja", "Sin fecha de última lectura", "No se puede valorar la vigencia de los consumos.", ["F. Últ. Lectura"]);

  // Consumo
  const { sum, known } = sumKnown(s.eaMensual);
  const annual = annualActive(s).value;
  if (s.eaAnual != null && known === 12 && s.eaAnual > 0 && Math.abs(sum - s.eaAnual) / s.eaAnual > 0.05)
    add("consumo-suma", "consumo", "media", "Suma mensual ≠ consumo anual", `Suma de meses ${Math.round(sum).toLocaleString("es-ES")} kWh frente a ${Math.round(s.eaAnual).toLocaleString("es-ES")} kWh anuales (${(((sum - s.eaAnual) / s.eaAnual) * 100).toFixed(1)} %). Pueden ser ventanas temporales distintas.`, ["E.A. Anual (kWh)", "E.A. Enero (kWh)…E.A. Diciembre (kWh)"]);
  const vals = s.eaMensual.filter((x): x is number => x != null);
  if (vals.length >= 6) {
    const med = [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)];
    const zeros = s.eaMensual.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
    if (zeros.length && med > 0) add("consumo-cero", "consumo", "media", "Meses con consumo cero", `${zeros.length} mes(es) a 0 kWh con mediana de ${Math.round(med).toLocaleString("es-ES")} kWh: posible baja temporal o error de lectura.`, ["E.A. mensual"]);
    const spikes = vals.filter((v) => med > 0 && v > med * 3);
    if (spikes.length) add("consumo-pico", "consumo", "media", "Consumo mensual anómalo", `${spikes.length} mes(es) superan 3× la mediana mensual.`, ["E.A. mensual"]);
  }
  if (annual === 0) add("consumo-nulo", "consumo", "media", "Consumo anual nulo", "El suministro no registra consumo en 12 meses.", ["E.A. Anual (kWh)"]);

  // Gas: no hi ha peatges elèctrics, potències ni reactiva; només regles generals i de consum.
  const gas = /gas/i.test(s.tipoEnergia ?? "");
  if (gas) {
    const missingGas: string[] = [];
    if (!s.tarifaRaw) missingGas.push("Tarifa");
    if (s.eaAnual == null) missingGas.push("Consumo anual");
    if (!s.distribuidora) missingGas.push("Distribuidora");
    if (missingGas.length) add("campos", "datos", missingGas.length >= 2 ? "media" : "baja", "Campos incompletos (gas)", `Sin dato: ${missingGas.join(", ")}.`, missingGas);
    return out;
  }

  // Potencias
  if (s.tarifa) {
    const n = tariffRules(s.tarifa).periods;
    const pc = s.potContratada.slice(0, n);
    if (pc.some((x) => x == null)) add("pot-incompleta", "potencia", "alta", "Potencias contratadas incompletas", `Faltan valores en ${pc.map((x, i) => (x == null ? `P${i + 1}` : null)).filter(Boolean).join(", ")}.`, ["Pot. P1..P6 (kW)"]);
    else {
      const errs = checkRules(s.tarifa, pc as number[]);
      if (errs.length) add("pot-reglas", "potencia", "alta", "Potencias incoherentes con el peaje", errs.join(" "), ["Pot. P1..P6 (kW)", "Tarifa"]);
    }
    if (s.tarifa === "2.0TD" && pc.some((x) => x != null && x > 1000)) add("pot-unidad", "datos", "alta", "Posible error de unidades", "Potencias > 1000 en 2.0TD: ¿vienen en W en lugar de kW?", ["Pot. P1..P6 (kW)"]);
  } else add("tarifa", "datos", "alta", "Tarifa no reconocida", `Valor: "${s.tarifaRaw ?? "vacío"}". No se pueden aplicar reglas ni precios regulados.`, ["Tarifa"]);

  const mc = maxContracted(s);
  const md = maxMonthlyDemand(s);
  if (mc != null && s.potMaxBIE != null && mc > s.potMaxBIE + 1e-9)
    add("pot-bie", "potencia", "alta", "Contratada superior a la BIE", `Máx. contratada ${mc} kW > Pot. Máx. BIE ${s.potMaxBIE} kW.`, ["Pot. P1..P6 (kW)", "Pot. Máx. BIE (kW)"]);
  if (md != null && s.potMaxBIE != null && md > s.potMaxBIE + 1e-9)
    add("dem-bie", "potencia", "alta", "Demanda registrada superior a la BIE", `Máxima registrada ${md} kW > BIE ${s.potMaxBIE} kW: revisar instalación.`, ["Pot. Anual (kW)", "Pot. Máx. BIE (kW)"]);
  if (s.tarifa && mc != null && md != null) {
    const mode = controlMode(s.tarifa, s.tipoPM, s.ctrlPotencia, mc).mode;
    if (md > mc + 1e-9)
      add("dem-supera", "potencia", mode === "icp" ? "media" : "alta", "Demanda máxima por encima de la contratada", `Registrada ${md} kW frente a ${mc} kW contratados (máx.). ${mode === "icp" ? "Con ICP implicaría cortes; revisar dato." : "Riesgo de excesos facturables."}`, ["Pot. Enero..Diciembre (kW)", "Pot. P1..P6 (kW)"]);
    else if (mc > 0 && (md / mc) * 100 < cfg.oversizeUtilPct)
      add("sobredim", "oportunidad", "info", "Posible sobredimensionamiento de potencia", `La máxima registrada (${md} kW) es el ${Math.round((md / mc) * 100)} % de la mayor potencia contratada (${mc} kW). Revisar con el Power Optimizer.`, ["Pot. Anual (kW)", "Pot. P1..P6 (kW)"]);
  }
  if (s.eaAnual != null && s.erAnual != null && s.eaAnual > 0 && s.tarifa && s.tarifa !== "2.0TD" && s.erAnual / s.eaAnual > 0.33)
    add("reactiva", "oportunidad", "media", "Energía reactiva elevada", `R/A anual = ${((s.erAnual / s.eaAnual) * 100).toFixed(0)} % (> 33 %). Posible penalización en P1–P5.`, ["E.R. Anual (kVArh)", "E.A. Anual (kWh)"]);

  // Campos críticos
  const missing: string[] = [];
  if (!s.tarifaRaw) missing.push("Tarifa");
  if (!s.tipoPMRaw) missing.push("Tipo P.M.");
  if (!s.ctrlPotencia) missing.push("Ctrl Potencia");
  if (s.eaAnual == null) missing.push("E.A. Anual");
  if (s.potAnual == null && s.potMensual.every((x) => x == null)) missing.push("Potencias registradas");
  if (s.potMaxBIE == null) missing.push("Pot. Máx. BIE");
  if (!s.distribuidora) missing.push("Distribuidora");
  if (missing.length) add("campos", "datos", missing.length >= 3 ? "media" : "baja", "Campos técnicos incompletos", `Sin dato: ${missing.join(", ")}.`, missing);
  return out;
}

export function sortAlerts(a: Alert[]) {
  return [...a].sort((x, y) => SEVERITY_ORDER.indexOf(x.severity) - SEVERITY_ORDER.indexOf(y.severity));
}
