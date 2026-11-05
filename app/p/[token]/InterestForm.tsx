"use client";
import { useState } from "react";

export function InterestForm({ token, offers }: { token: string; offers: { id: string; label: string }[] }) {
  const [offerId, setOfferId] = useState(offers[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const send = async (kind: "interes" | "aclariment") => {
    setState("busy");
    const r = await fetch("/api/public/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, kind, offerId, message, contact }) }).catch(() => null);
    setState(r?.ok ? "ok" : "err");
  };
  if (state === "ok") return <section className="rounded-2xl border border-ren/30 bg-ren/[0.06] p-5 text-sm">Gràcies! El teu assessor s&apos;hi posarà en contacte.</section>;
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-semibold">T&apos;interessa alguna alternativa?</h2>
      <select className="input" value={offerId} onChange={(e) => setOfferId(e.target.value)} aria-label="Alternativa">
        {offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <textarea className="input min-h-[80px]" placeholder="Missatge o dubte (opcional)" value={message} onChange={(e) => setMessage(e.target.value)} />
      <input className="input" placeholder="Telèfon o correu de contacte (opcional)" value={contact} onChange={(e) => setContact(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <button disabled={state === "busy"} onClick={() => send("interes")} className="pressable rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">M&apos;interessa</button>
        <button disabled={state === "busy"} onClick={() => send("aclariment")} className="pressable rounded-lg border border-line px-4 py-2 text-sm">Demana un aclariment</button>
      </div>
      {state === "err" && <p className="text-sm text-lost">No s&apos;ha pogut enviar. Torna-ho a provar més tard.</p>}
    </section>
  );
}
