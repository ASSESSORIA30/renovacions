"use client";
/** Fase 10 · Des d'una incidència: crear tasca (gestor de tasques), assignar responsable i programar seguiment (agenda). */
import { useState } from "react";
import { CalendarClock, ListPlus, Loader2 } from "lucide-react";
import { TZ, zonedToUtc } from "@/core/agenda";
import { useApp } from "@/data/store";
import { agendaApi, useComposer } from "./api";

const tomorrow17 = () => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() + 86400000)).split("-").map(Number); return zonedToUtc(p[0], p[1], p[2], 17, 0).toISOString(); };

export function IncidentAgendaActions({ incident, client, assignee }: { incident: { id: string; title: string }; client: { id: string; name: string } | null; assignee?: string | null }) {
  const [busy, setBusy] = useState(false);
  const me = useApp((s) => s.snap?.me);
  const createTask = async () => {
    setBusy(true);
    try {
      // tasca al gestor de tasques existent (no es crea cap taula nova), vinculada a la incidència i al client
      await agendaApi.work("task_create", "", { title: `Incidència: ${incident.title}`.slice(0, 200), kind: "incidencia", incident_id: incident.id, client_id: client?.id ?? null, assigned_to: assignee ?? me?.id ?? null, due_at: tomorrow17(), priority: "alta" });
      useApp.getState().toast({ title: "Tasca creada", body: "Demà a les 17:00, al gestor de tasques i a l'agenda.", tone: "ok" });
    } catch (e) { useApp.getState().toast({ title: "No s'ha pogut crear la tasca", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(false); }
  };
  const followUp = () => { const st = tomorrow17(); useComposer.getState().open({ kind: "seguiment", title: `Seguiment incidència: ${incident.title}`.slice(0, 200), incident_id: incident.id, client, owner_id: assignee ?? undefined, starts_at: st, ends_at: new Date(new Date(st).getTime() + 1800000).toISOString(), reminders: [60], context: "Incidència" }); };
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <button type="button" disabled={busy} onClick={() => void createTask()} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-muted hover:border-brand/40 hover:text-brand">{busy ? <Loader2 size={11} className="animate-spin" /> : <ListPlus size={11} />} Crear tasca</button>
      <button type="button" onClick={followUp} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-muted hover:border-brand/40 hover:text-brand"><CalendarClock size={11} /> Programar seguiment</button>
    </span>
  );
}
