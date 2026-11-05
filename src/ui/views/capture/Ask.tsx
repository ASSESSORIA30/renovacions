"use client";
/** Diàleg petit per demanar un text obligatori (motiu, nom…) sense diàlegs del navegador. */
import { useRef, useState } from "react";
import { Button, Modal } from "../../components/ui";

export function useAsk() {
  const [st, setSt] = useState<{ title: string; label: string; required: boolean } | null>(null);
  const [val, setVal] = useState("");
  const res = useRef<(v: string | null) => void>(() => undefined);
  const ask = (title: string, label = "Motiu", required = true) => new Promise<string | null>((resolve) => { res.current = resolve; setVal(""); setSt({ title, label, required }); });
  const close = (v: string | null) => { setSt(null); res.current(v); };
  const dialog = st ? (
    <Modal open onClose={() => close(null)} title={st.title} footer={<><Button onClick={() => close(null)}>Cancel·la</Button><Button variant="primary" disabled={st.required && val.trim().length < 3} onClick={() => close(val.trim())}>D&apos;acord</Button></>}>
      <label className="block text-[12.5px]">{st.label}<input autoFocus className="input mt-1 h-9" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (!st.required || val.trim().length >= 3)) close(val.trim()); }} /></label>
    </Modal>
  ) : null;
  return { ask, dialog };
}
