/**
 * Encaminament intern del mòdul energètic dins de la plataforma única.
 *
 * cups2 era una aplicació Next.js amb rutes pròpies (/radar, /suministro/?cups=…).
 * A la plataforma unificada totes les pantalles viuen dins del mateix shell i
 * l'estat de navegació és a `useApp` (vista + paràmetres), sincronitzat amb l'URL
 * (`/?v=fitxa&cups=ES…`) perquè el botó «enrere» del navegador i els enllaços funcionin.
 */
import type { View } from "@/data/store";

const PATH_TO_VIEW: Record<string, View> = {
  "": "energia",
  energia: "energia",
  sips: "sips",
  suministro: "fitxa",
  fitxa: "fitxa",
  radar: "radar",
  alertas: "alertes",
  alertes: "alertes",
  mercado: "mercat",
  mercat: "mercat",
  optimizer: "optimizer",
  ajustes: "ajustes",
};

/** Converteix un href de cups2 ("/suministro/?cups=ES…") en vista + paràmetres. */
export function resolveHref(href: string): { view: View; params: Record<string, string> } {
  const [path, query = ""] = href.split("?");
  const seg = path.replace(/^\/+|\/+$/g, "").split("/")[0] ?? "";
  const view = PATH_TO_VIEW[seg] ?? "energia";
  const params: Record<string, string> = {};
  new URLSearchParams(query).forEach((v, k) => (params[k] = v));
  if (view === "ajustes") params.tab = params.tab ?? "energia";
  return { view, params };
}

/** URL pública d'una vista (per a enllaços copiables). */
export function hrefFor(view: View, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ v: view, ...params });
  return `/?${q.toString()}`;
}
