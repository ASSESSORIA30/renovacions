"use client";
import { cn } from "../../components/ui";
import { STATUS_TXT, type TemplateRow } from "./templates-api";

/** Estat de verificació d'una plantilla de lectura (VERIFICADA · PENDENT · REVISIÓ NECESSÀRIA · ERROR · DESACTIVADA). */
export function TemplateStatusPill({ status }: { status: TemplateRow["status"] }) {
  const s = STATUS_TXT[status];
  return <span className={cn("inline-flex rounded-md px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide ring-1 ring-inset", s.cls)} data-testid="tpl-status">{s.label}</span>;
}
