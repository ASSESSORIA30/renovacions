/**
 * Seasonal / festive ambience (Catalonia). Pure function of the date → theme.
 * Festivities have priority over the four seasons. Movable dates (Carnaval, Pasqua) derive from Easter.
 */
import { addDays, toISODate } from "./dates";

export type Motion = "fall" | "rise" | "drift" | "burst";

export interface Theme {
  id: string;
  name: string; // name of the festivity / season
  greeting: string; // short line shown in the header chip
  icon: string; // emoji for the chip
  particles: string[]; // emojis used by the animation
  motion: Motion;
  density: number; // ambient particles kept on screen after the intro (0 = intro only)
  accent: [string, string]; // gradient for the top ribbon
  stripes?: boolean; // ribbon drawn as stripes (Diada)
}

/** Easter Sunday (Gregorian, anonymous algorithm). */
export function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return toISODate(new Date(year, month - 1, day));
}

const T = {
  capdany: { id: "capdany", name: "Cap d'Any", greeting: "Bon any nou! Que sigui un any de bones renovacions", icon: "🥂", particles: ["🎆", "🎇", "✨", "🥂", "🎉"], motion: "burst", density: 6, accent: ["#facc15", "#a855f7"] },
  reis: { id: "reis", name: "Reis", greeting: "Ses Majestats els Reis d'Orient ja són a prop", icon: "👑", particles: ["👑", "🐪", "🎁", "⭐", "✨"], motion: "fall", density: 7, accent: ["#eab308", "#7c3aed"] },
  sanvalenti: { id: "sanvalenti", name: "Sant Valentí", greeting: "Bon Sant Valentí: cuida els clients com a la parella", icon: "💌", particles: ["❤️", "💕", "💖", "🌹"], motion: "rise", density: 6, accent: ["#f43f5e", "#ec4899"] },
  carnaval: { id: "carnaval", name: "Carnaval", greeting: "Visca el Carnestoltes!", icon: "🎭", particles: ["🎭", "🎊", "🎉", "🪅", "✨"], motion: "fall", density: 8, accent: ["#f97316", "#8b5cf6"] },
  pasqua: { id: "pasqua", name: "Pasqua", greeting: "Bona Pasqua! Que no falti la mona", icon: "🐣", particles: ["🥚", "🐣", "🍫", "🐰", "🌷"], motion: "drift", density: 7, accent: ["#f59e0b", "#84cc16"] },
  santjordi: { id: "santjordi", name: "Sant Jordi", greeting: "Feliç Sant Jordi! Una rosa i un llibre", icon: "🌹", particles: ["🌹", "📚", "📖", "🐉", "🌹"], motion: "fall", density: 8, accent: ["#dc2626", "#facc15"] },
  festamajor: { id: "festamajor", name: "Festa Major de Lleida", greeting: "Bona Festa Major de Sant Anastasi!", icon: "🎉", particles: ["🎉", "🎊", "🥁", "🎺", "✨"], motion: "fall", density: 6, accent: ["#0ea5e9", "#f43f5e"] },
  santjoan: { id: "santjoan", name: "Revetlla de Sant Joan", greeting: "Bona revetlla! Coca, foc i petards", icon: "🔥", particles: ["🎆", "🎇", "🔥", "✨", "🥂"], motion: "burst", density: 6, accent: ["#f97316", "#facc15"] },
  diada: { id: "diada", name: "Diada Nacional de Catalunya", greeting: "Bona Diada!", icon: "🎗️", particles: [], motion: "drift", density: 0, accent: ["#facc15", "#dc2626"], stripes: true },
  halloween: { id: "halloween", name: "Halloween i Castanyada", greeting: "Truc o tracte? Que no se t'escapi cap renovació", icon: "🎃", particles: ["🎃", "🦇", "👻", "🕸️", "🌰", "🍬"], motion: "drift", density: 9, accent: ["#f97316", "#7c3aed"] },
  castanyada: { id: "castanyada", name: "Castanyada i Tots Sants", greeting: "Bona Castanyada! Castanyes, moniatos i panellets", icon: "🌰", particles: ["🌰", "🍠", "🍂", "🍁", "🌰"], motion: "fall", density: 8, accent: ["#b45309", "#f97316"] },
  tio: { id: "tio", name: "Temps de Tió", greeting: "Tapa el tió amb la manta i dona-li menjar cada dia!", icon: "🪵", particles: ["❄️", "🪵", "🎄", "🍊", "❄️", "🎁"], motion: "fall", density: 10, accent: ["#16a34a", "#dc2626"] },
  nadal: { id: "nadal", name: "Nadal", greeting: "Bon Nadal! El Pare Noel i el tió ja arriben", icon: "🎅", particles: ["🎅", "🎄", "🎁", "❄️", "⭐", "🪵", "❄️"], motion: "fall", density: 12, accent: ["#dc2626", "#16a34a"] },
  santesteve: { id: "santesteve", name: "Sant Esteve", greeting: "Bon Sant Esteve! Avui toquen canelons", icon: "🍝", particles: ["❄️", "🎄", "⭐", "❄️"], motion: "fall", density: 8, accent: ["#dc2626", "#16a34a"] },
  // seasons
  primavera: { id: "primavera", name: "Primavera", greeting: "Ha arribat la primavera", icon: "🌸", particles: ["🌸", "🌼", "🦋", "🌱"], motion: "drift", density: 6, accent: ["#ec4899", "#84cc16"] },
  estiu: { id: "estiu", name: "Estiu", greeting: "Bon estiu! Bon moment per revisar els consums d'aire condicionat", icon: "☀️", particles: ["☀️", "🌊", "🍉", "🏖️", "🌻"], motion: "rise", density: 5, accent: ["#f59e0b", "#06b6d4"] },
  tardor: { id: "tardor", name: "Tardor", greeting: "Bona tardor", icon: "🍂", particles: ["🍂", "🍁", "🍂", "🌰"], motion: "fall", density: 6, accent: ["#ea580c", "#a16207"] },
  hivern: { id: "hivern", name: "Hivern", greeting: "Bon hivern! Època de consums alts de calefacció", icon: "❄️", particles: ["❄️", "❄️", "☃️", "❄️"], motion: "fall", density: 8, accent: ["#38bdf8", "#6366f1"] },
} satisfies Record<string, Theme>;

export const THEMES: Record<string, Theme> = T;

const md = (iso: string) => iso.slice(5); // "MM-DD"
const inRange = (x: string, a: string, b: string) => x >= a && x <= b;

export function themeFor(iso: string): Theme {
  const d = md(iso);
  const y = Number(iso.slice(0, 4));
  const e = easter(y);

  if (d >= "12-30" || d <= "01-01") return T.capdany;
  if (inRange(d, "01-02", "01-06")) return T.reis;
  if (inRange(d, "02-13", "02-14")) return T.sanvalenti;
  if (inRange(iso, addDays(e, -52), addDays(e, -46))) return T.carnaval; // Dijous Gras → Dimecres de Cendra
  if (inRange(iso, addDays(e, -7), addDays(e, 1))) return T.pasqua; // Diumenge de Rams → Dilluns de Pasqua (mona)
  if (inRange(d, "04-21", "04-23")) return T.santjordi;
  if (inRange(d, "05-10", "05-12")) return T.festamajor;
  if (inRange(d, "06-22", "06-24")) return T.santjoan;
  if (inRange(d, "09-10", "09-11")) return T.diada;
  if (inRange(d, "10-24", "10-31")) return T.halloween;
  if (inRange(d, "11-01", "11-02")) return T.castanyada;
  if (inRange(d, "12-06", "12-20")) return T.tio;
  if (inRange(d, "12-21", "12-25")) return T.nadal;
  if (d === "12-26") return T.santesteve;
  if (inRange(d, "12-27", "12-29")) return T.nadal;
  // astronomical seasons (approximate)
  if (inRange(d, "03-20", "06-20")) return T.primavera;
  if (inRange(d, "06-21", "09-22")) return T.estiu;
  if (inRange(d, "09-23", "12-20")) return T.tardor;
  return T.hivern;
}
