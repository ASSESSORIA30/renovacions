"use client";
/** API compatible amb `sonner` que fa servir el sistema d'avisos únic de la plataforma. */
import { useApp } from "@/data/store";

type Opts = { description?: string };
type Tone = "ok" | "err" | "info";

function show(tone: Tone, title: string, o?: Opts) {
  useApp.getState().toast({ title, body: o?.description, tone });
}

export const toast = Object.assign((title: string, o?: Opts) => show("info", title, o), {
  success: (title: string, o?: Opts) => show("ok", title, o),
  error: (title: string, o?: Opts) => show("err", title, o),
  warning: (title: string, o?: Opts) => show("err", title, o),
  info: (title: string, o?: Opts) => show("info", title, o),
  message: (title: string, o?: Opts) => show("info", title, o),
});
