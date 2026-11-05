import { redirect } from "next/navigation";

/** Ruta antiga del portal (Fase 6): es conserva perquè els enllaços existents continuïn funcionant. */
export default function OldPortal() {
  redirect("/collaboradors");
}
