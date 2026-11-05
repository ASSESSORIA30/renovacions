import { daysUntil, fmtDate } from "./dates";
import { expiry } from "./insights";
import type { Contract, Settings, Template } from "./types";

export const DEFAULT_TEMPLATES: Template[] = [
  { id: "t1", builtIn: true, channel: "whatsapp", name: "1. Primer contacte",
    body: "Hola {{nombre}}, sóc {{comercial}} d'{{empresa}}. El seu contracte de {{suministro}} amb {{comercializadora}} venç el {{vencimiento}}. Li sembla bé que revisem les condicions de renovació perquè no pagui de més? Quedo a la seva disposició." },
  { id: "t2", builtIn: true, channel: "email", name: "2. Proposta de renovació", subject: "Proposta de renovació — {{nombre}}",
    body: "Benvolgut/da {{nombre}},\n\nLi adjuntem la proposta de renovació del seu subministrament {{cups_corto}} ({{suministro}}), el contracte del qual venç el {{vencimiento}}.\n\nHem revisat les seves dades de consum per oferir-li unes condicions competitives. Si té qualsevol dubte, pot respondre aquest correu o trucar-nos al {{telefono_empresa}}.\n\nSalutacions,\n{{comercial}}\n{{empresa}}" },
  { id: "t3", builtIn: true, channel: "whatsapp", name: "3. Recordatori",
    body: "Hola {{nombre}}, li recordem que el seu contracte de {{suministro}} venç d'aquí a {{dias}} dies ({{vencimiento}}). Ha pogut revisar la nostra proposta? Per a qualsevol dubte, som aquí. {{empresa}}" },
  { id: "t4", builtIn: true, channel: "whatsapp", name: "4. Segon seguiment",
    body: "Hola {{nombre}}, li torno a escriure per la renovació del seu subministrament {{cups_corto}}. Si ho prefereix, el truco quan li vagi millor. Salutacions, {{comercial}} ({{empresa}})." },
  { id: "t5", builtIn: true, channel: "email", name: "5. Avís urgent de venciment", subject: "El seu contracte venç el {{vencimiento}}",
    body: "Benvolgut/da {{nombre}},\n\nEl seu contracte de {{suministro}} ({{cups_corto}}) amb {{comercializadora}} venç d'aquí a {{dias}} dies. Per evitar que s'hi apliquin condicions menys favorables, li recomanem revisar la renovació com més aviat millor.\n\nPot contactar-nos al {{telefono_empresa}}.\n\nAtentament,\n{{comercial}}\n{{empresa}}" },
  { id: "t6", builtIn: true, channel: "email", name: "6. Confirmació de renovació", subject: "Renovació confirmada — {{nombre}}",
    body: "Benvolgut/da {{nombre}},\n\nLi confirmem que hem tramitat la renovació del seu subministrament {{cups_corto}}. El mantindrem informat de qualsevol novetat.\n\nGràcies per la seva confiança,\n{{comercial}}\n{{empresa}}" },
  { id: "t7", builtIn: true, channel: "whatsapp", name: "7. Agraïment",
    body: "Moltes gràcies, {{nombre}}! La seva renovació ja està en marxa. Per a qualsevol cosa que necessiti, ens pot escriure per aquí. {{empresa}}" },
  { id: "t8", builtIn: true, channel: "whatsapp", name: "8. Recuperació de client",
    body: "Hola {{nombre}}, sóc {{comercial}} d'{{empresa}}. Fa un temps no vam poder arribar a un acord amb el seu subministrament. Les condicions del mercat han canviat i ens agradaria tornar a revisar el seu cas sense compromís. Li sembla bé?" },
];

export function templateVars(c: Contract, s: Settings, comercial: string, extra: Record<string, string> = {}) {
  const d = daysUntil(expiry(c));
  const cups = c.cups ? `${c.cups.slice(0, 6)}…${c.cups.slice(-4)}` : "el seu subministrament";
  const suministro = c.tipo === "gas" ? "gas" : c.tipo === "telefonia" ? "telefonia" : "electricitat";
  return {
    nombre: titleCase(c.cliente),
    cliente: c.cliente,
    cups: c.cups ?? "",
    cups_corto: cups,
    vencimiento: fmtDate(expiry(c)),
    dias: d === null ? "—" : String(Math.max(d, 0)),
    comercializadora: c.comercializadora ?? "la seva comercialitzadora",
    tarifa: c.tarifa ?? "",
    suministro,
    comercial: titleCase(comercial),
    empresa: s.empresa.nombre,
    telefono_empresa: s.empresa.telefono,
    email_empresa: s.empresa.email,
    enlace_propuesta: extra.enlace_propuesta ?? "",
    ...extra,
  } as Record<string, string>;
}

export function render(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (k in vars ? vars[k] : m));
}

export function titleCase(s: string) {
  if (!s) return s;
  if (/\b(S\.?L\.?U?|S\.?A\.?|SCP|SCCL|CB|SAT)\b\.?$/i.test(s)) return s; // keep company names as written
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

export function whatsappLink(phone: string, text: string) {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(to: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
