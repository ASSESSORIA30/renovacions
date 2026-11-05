/**
 * Generador de datos SINTÉTICOS de demostración y pruebas. Produce filas con las
 * 97 cabeceras exactas del Excel SIPS, de modo que pasan por el mismo importador.
 * Todo lo generado se marca como DEMO en la interfaz.
 */
import { COLUMNS, MONTHS } from "./columns";
import { makeCups } from "./cups";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const LOCALIDADES: [string, string, string][] = [
  ["Barcelona", "Barcelona", "08"],
  ["Sabadell", "Barcelona", "08"],
  ["Girona", "Girona", "17"],
  ["Lleida", "Lleida", "25"],
  ["Tarragona", "Tarragona", "43"],
  ["Valencia", "Valencia", "46"],
  ["Zaragoza", "Zaragoza", "50"],
  ["Madrid", "Madrid", "28"],
  ["Palma", "Illes Balears", "07"],
];
const CALLES = ["C/ de la Indústria", "Av. del Progrés", "C/ Major", "Pol. Ind. Les Forques", "C/ del Comerç", "Av. Diagonal", "C/ Sant Joan", "Ronda Nord"];
const COMERS = ["Comercializadora Alfa (demo)", "Comercializadora Beta (demo)", "Comercializadora Gamma (demo)", "Comercializadora Delta (demo)"];
const DISTRS = ["Distribuidora Norte (demo)", "Distribuidora Este (demo)", "Distribuidora Centro (demo)"];
const CNAES = ["1071", "2511", "4711", "5610", "5510", "8610", "4120", "1013", "6820", "9311"];

// Perfiles estacionales relativos (ene..dic)
const PROFILE_INDUSTRIA = [1, 0.98, 1.02, 0.95, 1, 1.05, 1.08, 0.7, 1, 1.02, 1, 0.9];
const PROFILE_COMERCIO = [1.1, 1, 0.95, 0.85, 0.9, 1.1, 1.3, 1.3, 1.05, 0.9, 0.95, 1.1];
const PROFILE_HOGAR = [1.3, 1.2, 1, 0.85, 0.8, 0.9, 1.1, 1.05, 0.85, 0.85, 1.05, 1.3];

const iso = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const addDays = (base: Date, n: number) => new Date(base.getTime() + n * 86400000);

export function demoRows(count = 42, today = new Date("2026-10-30T00:00:00Z")) {
  const r = rng(30_2026);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const header = COLUMNS.map((c) => c.header);
  const rows: (string | number | null)[][] = [header];

  for (let i = 0; i < count; i++) {
    const kind = i % 7 === 0 ? "6.1TD" : i % 3 === 0 ? "2.0TD" : "3.0TD";
    const [loc, prov, cpPref] = i === 11 ? LOCALIDADES[8] : pick(LOCALIDADES.slice(0, 8));
    const row: Record<string, string | number | null> = {};
    const digits = `0${(21 + (i % 3)).toString().padStart(3, "0")}${String(100000000000 + Math.floor(r() * 899999999999)).slice(0, 12)}`;
    row["Tipo Energía"] = "Electricidad";
    row["CUPS"] = makeCups(digits.slice(0, 16));
    row["Dirección"] = `${pick(CALLES)}, ${1 + Math.floor(r() * 180)}`;
    row["Provincia"] = prov;
    row["Localidad"] = loc;
    row["Código Postal"] = `${cpPref}${String(Math.floor(r() * 999)).padStart(3, "0")}`;
    row["Distribuidora"] = pick(DISTRS);
    row["Comercializadora"] = pick(COMERS);
    row["Tarifa"] = kind;

    let pc: number[];
    let profile = PROFILE_INDUSTRIA;
    let annual: number;
    let tipoPM: number;
    let ctrl: string;
    let tension: number;
    if (kind === "2.0TD") {
      const p = pick([3.45, 4.6, 5.75, 6.928, 9.2, 10.392, 13.856]);
      pc = [p, p, 0, 0, 0, 0];
      profile = r() > 0.5 ? PROFILE_HOGAR : PROFILE_COMERCIO;
      annual = Math.round(2500 + r() * 9000);
      tipoPM = 5;
      ctrl = "ICP";
      tension = 230;
    } else if (kind === "3.0TD") {
      const base = Math.round(18 + r() * 120);
      const big = r() > 0.5;
      pc = big ? [base, base, base, base, base, base] : [base, base, base + 5, base + 5, base + 10, base + 10];
      profile = r() > 0.5 ? PROFILE_INDUSTRIA : PROFILE_COMERCIO;
      annual = Math.round(base * (900 + r() * 2600));
      tipoPM = Math.max(...pc) > 50 ? 3 : 4;
      ctrl = "Maxímetro";
      tension = 400;
    } else {
      const base = Math.round(150 + r() * 600);
      pc = [base, base, base, base, base + 50, base + 100];
      annual = Math.round(base * (2500 + r() * 3500));
      tipoPM = Math.max(...pc) > 450 ? 2 : 3;
      ctrl = "Maxímetro";
      tension = 25000;
    }
    const n = kind === "2.0TD" ? 2 : 6;
    for (let p = 0; p < 6; p++) row[`Pot. P${p + 1} (kW)`] = p < n ? pc[p] : null;
    const maxPc = Math.max(...pc);
    const bie = Math.round(maxPc * (1.1 + r() * 0.6) * 10) / 10;
    row["F. Alta"] = iso(addDays(today, -Math.floor(800 + r() * 6000)));
    row["Tensión (V)"] = tension;
    row["Pot. Máx. BIE (kW)"] = bie;
    row["Pot. Máx. APM (kW)"] = kind === "2.0TD" ? null : Math.round(bie * 0.95 * 10) / 10;
    row["Tipo P.M."] = String(tipoPM);
    row["Disp. ICP"] = kind === "2.0TD" ? "Contador telegestionado" : "No";
    row["Tipo Perfil Consumo"] = kind === "2.0TD" ? "Pa" : kind === "3.0TD" ? "Pc" : "-";
    row["Derechos Extensión (kW)"] = maxPc;
    row["Derechos Acceso (kW)"] = maxPc;
    row["Prop. E.M."] = r() > 0.6 ? "Cliente" : "Distribuidora";
    row["Prop. ICP"] = "Distribuidora";
    row["F. Últ. Mov. Contrato"] = iso(addDays(today, -Math.floor(60 + r() * 1500)));
    row["F. Últ. Cambio Comer."] = iso(addDays(today, -Math.floor(90 + r() * 2200)));
    row["F. Límite Derechos Reconocidos"] = r() > 0.75 ? iso(addDays(today, Math.floor(20 + r() * 400))) : null;
    row["F. Últ. Lectura"] = iso(addDays(today, -(i % 9 === 4 ? 150 : Math.floor(5 + r() * 40))));
    row["Informacion Impagos"] = i === 9 ? "SI - 2 facturas pendientes (demo)" : "NO";
    row["Importe Deposito Garantía (€)"] = 0;
    row["Tipo Id. Titular"] = kind === "2.0TD" && r() > 0.5 ? "NIF" : "CIF";
    row["Vivienda Habitual"] = kind === "2.0TD" ? (r() > 0.5 ? "S" : "N") : "N";
    row["Telegestión"] = kind === "6.1TD" ? "Telemedida" : "Telegestionado";
    row["Fases E.M."] = kind === "2.0TD" ? "Monofásico" : "Trifásico";
    row["Autoconsumo"] = i % 8 === 2 ? "41 - Con excedentes acogido a compensación" : "00 - Sin autoconsumo";
    row["Tipo Contrato ATR"] = "Indefinido";
    row["Per. Facturación"] = "Mensual";
    row["Código BIE"] = `BIE-DEMO-${1000 + i}`;
    row["F. Emisión BIE"] = iso(addDays(today, -Math.floor(2000 + r() * 3000)));
    const bieExp = i % 6 === 1 ? -Math.floor(10 + r() * 300) : i % 6 === 3 ? Math.floor(15 + r() * 60) : Math.floor(400 + r() * 3000);
    row["F. Caducidad BIE"] = iso(addDays(today, bieExp));
    row["Código APM"] = kind === "2.0TD" ? null : `APM-DEMO-${2000 + i}`;
    row["F. Emisión APM"] = kind === "2.0TD" ? null : iso(addDays(today, -Math.floor(1500 + r() * 2000)));
    row["F. Caducidad APM"] = kind === "2.0TD" ? null : iso(addDays(today, i % 10 === 5 ? -40 : Math.floor(200 + r() * 2500)));
    row["Relación Trans. Intensidad"] = kind === "6.1TD" ? "200/5" : null;
    row["CNAE"] = kind === "2.0TD" && row["Vivienda Habitual"] === "S" ? "9820" : pick(CNAES);
    row["Ctrl Potencia"] = ctrl;
    row["Potencia CGP"] = kind === "2.0TD" ? "63 A" : kind === "3.0TD" ? "250 A" : "-";
    row["Tipo D.H. E.M."] = kind === "2.0TD" ? "3P" : "6P";
    row["Acceso Contador"] = "Accesible";
    row["Contratable"] = i === 16 ? "NO" : "SI";
    row["Motivo NO Contratable"] = i === 16 ? "Suministro en proceso de baja (demo)" : null;
    row["Tensión E.M. (V)"] = tension;
    row["Tipo Exp."] = null;
    row["Motivo Exp."] = null;
    row["Tipo Suministro"] = kind === "2.0TD" ? "Doméstico/PYME" : "Empresa";
    row["Bono Social"] = "NO";

    // Consumo mensual
    const sumP = profile.reduce((a, b) => a + b, 0);
    const missing = i === 20 ? [3, 4] : [];
    const eaM = profile.map((f, m) => (missing.includes(m) ? null : Math.round((annual * f * (0.95 + r() * 0.1)) / sumP)));
    const reactRatio = kind === "2.0TD" ? 0.15 : i % 5 === 2 ? 0.45 + r() * 0.5 : 0.1 + r() * 0.25;
    const erM = eaM.map((a) => (a == null ? null : Math.round(a * reactRatio * (0.85 + r() * 0.3))));
    // Demanda máxima: proporcional al consumo mensual, con sobredimensionamiento variable
    const loadUse = i % 4 === 1 ? 0.35 + r() * 0.15 : 0.6 + r() * 0.35;
    const maxEa = Math.max(...eaM.filter((x): x is number => x != null));
    const potM = eaM.map((a) => (a == null ? null : Math.round(maxPc * loadUse * (0.75 + 0.25 * (a / maxEa)) * (0.95 + r() * 0.1) * 10) / 10));
    if (i % 11 === 6) potM[6] = Math.round(maxPc * 1.12 * 10) / 10; // exceso puntual
    const sumEa = eaM.reduce<number>((a, b) => a + (b ?? 0), 0);
    row["E.A. Anual (kWh)"] = missing.length ? annual : sumEa;
    row["E.R. Anual (kVArh)"] = erM.reduce<number>((a, b) => a + (b ?? 0), 0);
    row["Pot. Anual (kW)"] = Math.max(...potM.filter((x): x is number => x != null));
    MONTHS.forEach((m, k) => {
      row[`E.A. ${m} (kWh)`] = eaM[k];
      row[`E.R. ${m} (kVArh)`] = erM[k];
      row[`Pot. ${m} (kW)`] = potM[k];
    });
    rows.push(header.map((h) => row[h] ?? null));
  }
  return rows;
}
