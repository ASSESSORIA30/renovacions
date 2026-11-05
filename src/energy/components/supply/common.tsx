"use client";
import { Database, Clock, FileSpreadsheet, CalendarCheck2 } from "lucide-react";
import type { Supply } from "@/energy/lib/types";
import { fmt } from "@/energy/lib/format";
import { Badge, DemoBadge, Tip } from "../ui";

export function availability(a: (number | null)[]) {
  return a.filter((x) => x != null).length;
}

export function Provenance({ s, compact }: { s: Supply; compact?: boolean }) {
  const ea = availability(s.eaMensual);
  const er = availability(s.erMensual);
  const pw = availability(s.potMensual);
  const tone = (k: number) => (k === 12 ? "good" : k >= 9 ? "warning" : "serious");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-[11px] text-fg-3">
      <span className="flex items-center gap-1.5">
        <FileSpreadsheet className="size-3.5" /> Origen: <b className="font-medium text-fg-2">{s.source.file}</b> · hoja {s.source.sheet} · fila {s.source.row}
      </span>
      <span className="flex items-center gap-1.5">
        <Clock className="size-3.5" /> Importado {fmt.dateTime(s.source.importedAt)}
      </span>
      <span className="flex items-center gap-1.5">
        <CalendarCheck2 className="size-3.5" /> Últ. lectura {fmt.date(s.fUltLectura)}
      </span>
      {!compact && (
        <span className="flex items-center gap-1.5">
          <Database className="size-3.5" /> Disponibilidad:
          <Tip content="Meses con dato en el Excel. Los meses no indican año: corresponden a la ventana móvil de 12 meses del origen SIPS.">
            <span className="flex gap-1">
              <Badge tone={tone(ea)}>E.A. {ea}/12</Badge>
              <Badge tone={tone(er)}>E.R. {er}/12</Badge>
              <Badge tone={tone(pw)}>Pot. {pw}/12</Badge>
            </span>
          </Tip>
          <Badge tone="neutral">Mensual agregado · sin desglose P1–P6</Badge>
        </span>
      )}
      <DemoBadge show={s.source.demo} />
    </div>
  );
}

export const GLOSSARY = {
  potContratada: {
    title: "Potencia contratada (kW)",
    text: "Valor contractual por periodo P1–P6. Se factura en el término de potencia (€/kW·año). No es una medida: es lo que el cliente paga por tener disponible.",
  },
  potBIE: {
    title: "Potencia máxima BIE / APM (kW)",
    text: "Potencia máxima AUTORIZADA por la instalación (Boletín de Instalación Eléctrica / Acta de Puesta en Marcha). Es un límite técnico-administrativo, no una demanda medida. No se puede contratar por encima.",
  },
  potRegistrada: {
    title: "Potencia registrada mensual (kW)",
    text: "Demanda máxima MEDIDA por el contador en cada mes, agregada sin indicar en qué periodo ocurrió. Pot. Anual = máxima de los 12 meses.",
  },
  activa: {
    title: "Energía activa (kWh)",
    text: "Energía consumida y facturada en el término de energía. 1 MWh = 1.000 kWh. El total anual procede de la columna E.A. Anual; nunca se suma con los meses para no duplicar.",
  },
  reactiva: {
    title: "Energía reactiva (kVArh)",
    text: "Energía que intercambian motores, transformadores o fluorescentes sin producir trabajo útil. Se penaliza cuando supera el 33 % de la activa en P1–P5 (cos φ < 0,95), salvo en 2.0TD.",
  },
};
