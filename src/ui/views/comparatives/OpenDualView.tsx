"use client";
/**
 * VISTA DOBLE DEL LECTOR · TARIFA OPEN D'ENDESA
 *  Esquerra: el document original (PDF) i el que se n'ha llegit (preus Open / No Open, trams, horaris, vigència).
 *  Dreta: la conversió a P1–P6 — hores Open i No Open de cada període, % i PREU ESTIMAT PER PONDERACIÓ HORÀRIA.
 *  Es pot canviar la modalitat, el tram (per potència P6) i el període de referència; veure fórmules, horaris i
 *  discrepàncies; corregir una regla des del xat; desar-la a la biblioteca (Direcció l'aprova) i desar les ofertes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookCheck, Calculator, CheckCircle2, FileText, Loader2, MessageSquare, Send, Sparkles, Upload } from "lucide-react";
import { openApi, tariffsApi, type LibraryRule } from "@/comparator/client";
import {
  ESTIMATE_LABEL, ESTIMATE_NOTE, bracketForP6, convertModality, effectiveRules, openToOffers,
  type ModalityRule, type OpenDocument,
} from "@/comparator/endesa-open";
import {
  DEFAULT_CALENDAR, MODALITIES, MODALITY_LABEL, defaultReference, describeRule, yearReference,
  type CalendarConfig, type Modality, type OpenRule,
} from "@/comparator/open-calendar";
import type { ChatProposal, OpenChatContext } from "@/comparator/open-chat";
import { useApp } from "@/data/store";
import { Badge, Button, Notice, cn } from "../../components/ui";

const f6 = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ca-ES", { minimumFractionDigits: 6, maximumFractionDigits: 6 }));
const SOURCE: Record<ModalityRule["source"], string> = { direccio: "Regla de Direcció", document: "Horari del document", biblioteca: "Biblioteca (aprovada)", xat: "Correcció del xat (sense desar)" };
type Msg = { role: "user" | "assistant"; text: string; proposal?: ChatProposal | null };

export function OpenDualView({ doc, file, onDone, onCancel }: { doc: OpenDocument; file: File | null; onDone: () => void; onCancel: () => void }) {
  const role = useApp((s) => s.snap?.me.role);
  const toast = useApp((s) => s.toast);
  const isAdmin = role === "admin";
  const [modality, setModality] = useState<Modality>("dia");
  const [bracketIdx, setBracketIdx] = useState(0);
  const [p6, setP6] = useState("");
  const [refKey, setRefKey] = useState("12m");
  const [formulas, setFormulas] = useState(false);
  const [library, setLibrary] = useState<{ rules: LibraryRule[]; approved: Partial<Record<Modality, { id: string; rule: OpenRule; note: string | null; by: string | null; at: string | null }>>; calendar: { extraHolidays: string[]; removedHolidays: string[] } | null; migrated: boolean } | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<Modality, ModalityRule>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [activate, setActivate] = useState(false);
  const pdfUrl = useMemo(() => (file && /\.pdf$/i.test(file.name) ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const key = { supplier: doc.supplier, product: doc.product, tariff: doc.tariff, version: doc.docVersion };
  const loadLibrary = () => openApi.library(key).then(setLibrary).catch(() => setLibrary({ rules: [], approved: {}, calendar: null, migrated: false }));
  useEffect(() => { void loadLibrary(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ref = useMemo(() => (refKey === "12m" ? defaultReference() : yearReference(Number(refKey))), [refKey]);
  const cfg: CalendarConfig = useMemo(() => ({ ...DEFAULT_CALENDAR, extraHolidays: library?.calendar?.extraHolidays ?? [], removedHolidays: library?.calendar?.removedHolidays ?? [] }), [library]);
  const rules = useMemo(() => {
    const lib: Partial<Record<Modality, ModalityRule>> = {};
    for (const m of MODALITIES) { const a = library?.approved[m]; if (a) lib[m] = { rule: a.rule, source: "biblioteca", approved: true, note: a.note }; }
    return effectiveRules({ ...lib, ...overrides });
  }, [library, overrides]);
  const bracket = doc.brackets[bracketIdx] ?? doc.brackets[0];
  const conv = useMemo(() => (bracket ? convertModality(doc, bracket, modality, rules[modality], ref, cfg) : null), [doc, bracket, modality, rules, ref, cfg]);
  const all = useMemo(() => (bracket ? MODALITIES.map((m) => convertModality(doc, bracket, m, rules[m], ref, cfg)) : []), [doc, bracket, rules, ref, cfg]);
  const pending = (library?.rules ?? []).filter((r) => r.status === "proposada");

  const onP6 = (v: string) => {
    setP6(v);
    const b = bracketForP6(doc, Number(v.replace(",", ".")));
    if (b) setBracketIdx(doc.brackets.indexOf(b));
  };
  const p6Bracket = p6 ? bracketForP6(doc, Number(p6.replace(",", "."))) : null;

  const propose = async (m: Modality, r: ModalityRule, source: "document" | "xat" | "manual" | "direccio", approve = false) => {
    setBusy("Desant la regla…");
    try {
      const c = all.find((x) => x.modality === m);
      const res = await openApi.propose({ ...key, kind: "modalitat", modality: m, rule: r.rule, source, note: r.note ?? null, discrepancies: c?.discrepancies ?? null, approve });
      toast({ title: res.approved ? "Regla aprovada i desada a la biblioteca" : "Regla proposada", body: res.approved ? "S'aplicarà automàticament als documents equivalents." : "Direcció l'ha de validar.", tone: "ok" });
      setOverrides((o) => { const n = { ...o }; delete n[m]; return n; });
      await loadLibrary();
    } catch (e) { toast({ title: "No s'ha pogut desar la regla", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };
  const decide = async (id: string, d: "aprovada" | "rebutjada") => {
    setBusy("Desant la decisió…");
    try { await openApi.decide(id, d); toast({ title: d === "aprovada" ? "Regla aprovada" : "Regla rebutjada", tone: "ok" }); await loadLibrary(); }
    catch (e) { toast({ title: "No s'ha pogut desar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };

  const saveOffers = async () => {
    setBusy("Desant les ofertes al catàleg…");
    try {
      const built = openToOffers(doc, rules, ref, { fileName: file?.name ?? "Tarifa Open", cfg });
      const ok = built.filter((x) => !x.conversion.needsApproval).map((x) => x.offer);
      const wait = built.filter((x) => x.conversion.needsApproval).map((x) => x.offer);
      const base = { fileName: file?.name ?? "Tarifa Open", supplierName: doc.supplier, mapping: { lector: "endesa-open", referencia: `${ref.from}/${ref.to}` }, report: [], keepIncompleteAsDraft: true, dryRun: false };
      let saved = 0, activated = 0;
      if (ok.length) { const r = await tariffsApi.importConfirm({ ...base, counts: { aprovades: ok.length }, offers: ok, activateComplete: activate }); saved += r.saved; activated += r.activated; }
      if (wait.length) { const r = await tariffsApi.importConfirm({ ...base, counts: { pendents_validacio: wait.length }, offers: wait, activateComplete: false }); saved += r.saved; }
      toast({ title: `${saved} ofertes Open desades`, body: `${activated} activades · ${wait.length} en esborrany fins que Direcció validi la conversió`, tone: "ok" });
      onDone();
    } catch (e) { toast({ title: "No s'han pogut desar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };

  if (!bracket || !conv) return <Notice tone="red">No s&apos;ha pogut llegir la taula de preus del document.</Notice>;
  const years = [new Date().getFullYear(), new Date().getFullYear() + 1];
  const r = rules[modality];
  const sch = doc.schedules[modality];

  return (
    <div className="space-y-3" data-testid="open-dual">
      {doc.warnings.length > 0 && <Notice>{doc.warnings.join(" · ")}</Notice>}
      <div className="grid gap-3 xl:grid-cols-2">
        {/* ============================ ESQUERRA: TARIFA ORIGINAL */}
        <section className="min-w-0 space-y-3 rounded-2xl border border-line bg-surface p-4" aria-label="Tarifa original Endesa">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold"><FileText size={15} className="text-brand" /> Tarifa original · {doc.supplier} {doc.product} {doc.tariff}</h3>
          {pdfUrl ? <iframe title="Document original" src={`${pdfUrl}#view=FitH`} className="h-[380px] w-full rounded-xl border border-line bg-white" /> : <p className="text-[12px] text-muted">El document original no es conserva al servidor; torna'l a carregar per veure'l aquí.</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
            <Item k="Comercialitzadora" v={doc.supplier} />
            <Item k="Tarifa d'accés" v={`${doc.tariff}${doc.maxKw ? ` (fins a ${doc.maxKw} kW)` : ""}`} />
            <Item k="Modalitat Open" v={MODALITY_LABEL[modality]} />
            <Item k="Tram de potència (P6)" v={bracket.label} />
            <Item k="Preu Open" v={`${f6(conv.openPrice)} €/kWh`} strong />
            <Item k="Preu No Open" v={modality === "plana" ? "No aplica" : `${f6(conv.noOpenPrice)} €/kWh`} strong />
            <Item k="Descomptes inclosos" v={doc.impliedDiscounts[modality] != null ? `${doc.impliedDiscounts[modality]} % sobre el preu base${doc.generalDiscountPct ? ` (inclou el ${doc.generalDiscountPct} % general)` : ""}` : "—"} />
            <Item k="Preu base sense descompte" v={bracket.base ? `${f6(bracket.base)} €/kWh` : "—"} />
            <Item k="Horari del document" v={sch?.text || "No llegit"} wide />
            <Item k="Vigència comercial" v={doc.validFrom ? `${doc.validFrom} – ${doc.validTo}` : "—"} />
            <Item k="Origen" v={`Pàgina ${doc.page}${doc.docVersion ? ` · versió ${doc.docVersion}` : ""}`} />
            <Item k="Terme de potència" v={doc.power.map((x, i) => `P${i + 1} ${x == null ? "—" : f6(x)}`).join(" · ") + " €/kW·any"} wide />
          </dl>
          <p className="text-[11px] text-muted">La vigència comercial del PDF és la data de contractació de l&apos;oferta; no té res a veure amb el calendari de ponderació (dreta).</p>
        </section>

        {/* ============================ DRETA: CONVERSIÓ P1–P6 */}
        <section className="min-w-0 space-y-3 rounded-2xl border border-line bg-surface p-4" aria-label="Conversió P1–P6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-[14px] font-semibold"><Calculator size={15} className="text-brand" /> Conversió P1–P6</h3>
            {modality !== "plana" && <Badge tone="amber">{ESTIMATE_LABEL}</Badge>}
          </div>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Modalitat Open">
            {MODALITIES.map((m) => (
              <button key={m} role="tab" aria-selected={m === modality} onClick={() => setModality(m)} className={cn("pressable rounded-lg border px-2.5 py-1 text-[12.5px]", m === modality ? "border-brand bg-brand/10 font-semibold text-brand" : "border-line text-muted hover:text-ink")}>
                {MODALITY_LABEL[m]}{all.find((x) => x.modality === m)?.needsApproval && <AlertTriangle size={11} className="ml-1 inline text-amber-600" />}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block"><span className="label">Potència contractada P6 (kW)</span><input className="input tnum" inputMode="decimal" value={p6} onChange={(e) => onP6(e.target.value)} placeholder="p. ex. 40" aria-label="Potència P6" /></label>
            <label className="block"><span className="label">Tram de preus</span>
              <select className="input" value={bracketIdx} onChange={(e) => { setBracketIdx(Number(e.target.value)); setP6(""); }} aria-label="Tram de preus">{doc.brackets.map((b, i) => <option key={b.label} value={i}>{b.label}</option>)}</select>
            </label>
            <label className="block"><span className="label">Període de referència</span>
              <select className="input" value={refKey} onChange={(e) => setRefKey(e.target.value)} aria-label="Període de referència">
                <option value="12m">12 mesos des del mes vinent</option>{years.map((y) => <option key={y} value={y}>Any {y}</option>)}
              </select>
            </label>
          </div>
          {p6 && !p6Bracket && <p className="text-[12px] text-red-600">Cap tram del document inclou {p6} kW de P6.</p>}
          {modality !== "plana" && <p className="rounded-lg bg-amber-500/[0.07] px-3 py-2 text-[12px] text-amber-900 dark:text-amber-200">{ESTIMATE_NOTE}</p>}

          <table className="w-full text-[12.5px]" data-testid="open-table">
            <thead className="text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="py-1">Període</th><th>Hores Open</th><th>Hores No Open</th><th>% Open</th><th className="w-[22%]" /><th className="text-right">Preu estimat</th></tr></thead>
            <tbody>
              {conv.periods.map((p) => {
                const d = conv.discrepancies.find((x) => x.period === p.period);
                return (
                  <tr key={p.period} className="border-t border-line align-middle">
                    <td className="py-2 font-semibold">P{p.period}{d && <AlertTriangle size={12} className="ml-1 inline text-amber-600" aria-label="Discrepància amb el document" />}</td>
                    <td className="tnum">{p.open.toLocaleString("ca-ES")}</td>
                    <td className="tnum">{p.noOpen.toLocaleString("ca-ES")}</td>
                    <td className="tnum">{p.openPct.toLocaleString("ca-ES")} %</td>
                    <td><div className="flex h-2.5 overflow-hidden rounded-full bg-ink/10" title={`${p.openPct} % Open`}><div className="bg-brand" style={{ width: `${p.openPct}%` }} /></div></td>
                    <td className="text-right"><span className="text-[17px] font-semibold tnum" data-testid={`preu-P${p.period}`}>{f6(p.price)}</span> <span className="text-[11px] text-muted">€/kWh</span>
                      {formulas && <span className="block text-[10.5px] text-muted">{p.formula}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={formulas} onChange={(e) => setFormulas(e.target.checked)} /> Mostra les fórmules</label>
            <span className="text-muted">{conv.totalHours.toLocaleString("ca-ES")} h · {ref.from} – {ref.to}{conv.dstDays.length ? ` · canvis d'hora: ${conv.dstDays.map((d) => `${d.date} (${d.hours} h)`).join(", ")}` : ""}</span>
          </div>
          <details className="rounded-xl border border-line p-3 text-[12px]">
            <summary className="cursor-pointer font-medium">Horaris aplicats i calendari</summary>
            <ul className="mt-2 space-y-1">
              <li><b>Regla aplicada</b> ({SOURCE[r.source]}{r.approved ? ", aprovada" : ""}): {describeRule(r.rule)}</li>
              <li><b>Document</b>: {conv.documentRule ? describeRule(conv.documentRule) : "no s'ha pogut interpretar"}</li>
              <li><b>Calendari</b>: {doc.tariff} Península (Circular CNMC 3/2020), hora local Europe/Madrid. Festius nacionals: {conv.holidays.join(", ") || "cap"}.</li>
            </ul>
          </details>
          {conv.discrepancies.length > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3 text-[12.5px]" data-testid="discrepancies">
              <p className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle size={14} /> La regla interna no coincideix amb l&apos;horari del document</p>
              <ul className="space-y-0.5">{conv.discrepancies.map((d) => <li key={d.period}>P{d.period}: {d.internalOpen} h Open (regla) vs {d.documentOpen} h (document) → {f6(d.internalPrice)} vs {f6(d.documentPrice)} €/kWh</li>)}</ul>
              <p className="text-[11.5px]">{conv.needsApproval ? "Aquesta conversió queda pendent fins que Direcció la validi: les ofertes es desaran com a esborrany." : "Direcció ja ha aprovat la regla aplicada."}</p>
              <div className="flex flex-wrap gap-1.5">
                {conv.documentRule && r.source !== "document" && <Button size="sm" onClick={() => setOverrides((o) => ({ ...o, [modality]: { rule: conv.documentRule!, source: "document", approved: false } }))}>Calcula amb l&apos;horari del document</Button>}
                {r.source !== "direccio" && <Button size="sm" variant="ghost" onClick={() => setOverrides((o) => { const n = { ...o }; delete n[modality]; return n; })}>Torna a la regla anterior</Button>}
                <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void propose(modality, r, r.source === "document" ? "document" : r.source === "xat" ? "xat" : r.source === "biblioteca" ? "manual" : "direccio", isAdmin)}><BookCheck size={13} /> {isAdmin ? "Aprova aquesta regla" : "Proposa-la a Direcció"}</Button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-5 gap-1 text-center text-[11px]" aria-label="Resum de modalitats">
            {all.map((c) => (
              <button key={c.modality} onClick={() => setModality(c.modality)} className={cn("rounded-lg border px-1 py-1.5", c.modality === modality ? "border-brand" : "border-line")}>
                <span className="block font-semibold">{MODALITY_LABEL[c.modality]}</span>
                <span className="block text-muted">P1 {f6(c.periods[0].price)}</span>
                <span className="block text-muted">P6 {f6(c.periods[5].price)}</span>
                {c.needsApproval ? <span className="text-amber-700">Pendent</span> : <span className="text-ren">OK</span>}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <OpenChat conv={conv} tariff={doc.tariff} onApply={(p) => { setModality(p.modality); setOverrides((o) => ({ ...o, [p.modality]: { rule: p.rule, source: "xat", approved: false, note: `Correcció del xat: ${p.summary}` } })); }}
          onSave={(p) => void propose(p.modality, { rule: p.rule, source: "xat", approved: false, note: `Correcció del xat: ${p.summary}` }, "xat", isAdmin)} isAdmin={isAdmin} />
        <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold"><BookCheck size={15} className="text-brand" /> Biblioteca de regles</h3>
          {!library ? <p className="flex items-center gap-2 text-muted"><Loader2 size={13} className="animate-spin" /> Carregant…</p> : !library.migrated ? <Notice>Falta aplicar la migració 022 a Supabase: les regles no es poden desar encara.</Notice> : (
            <>
              <p className="text-muted">Aprovades: {MODALITIES.filter((m) => library.approved[m]).map((m) => MODALITY_LABEL[m]).join(", ") || "cap (s'apliquen les regles de Direcció)"}.</p>
              {pending.length > 0 && <ul className="divide-y divide-line rounded-xl border border-line">{pending.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <Badge tone="amber">Pendent</Badge><b>{p.modality ? MODALITY_LABEL[p.modality] : "Calendari"}</b>
                  <span className="min-w-0 flex-1 text-muted">{describeRule(p.rule as OpenRule)} · {p.created_by_name ?? "—"}</span>
                  {isAdmin && <><Button size="sm" disabled={!!busy} onClick={() => void decide(p.id, "aprovada")}>Aprova</Button><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void decide(p.id, "rebutjada")}>Rebutja</Button></>}
                </li>))}</ul>}
              {Object.keys(overrides).length > 0 && <Notice tone="blue">Tens canvis de regla sense desar ({Object.keys(overrides).map((m) => MODALITY_LABEL[m as Modality]).join(", ")}). Desa&apos;ls a la biblioteca perquè es reutilitzin.</Notice>}
            </>
          )}
          <div className="border-t border-line pt-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> Activa directament les ofertes amb la conversió validada</label>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="primary" disabled={!!busy} onClick={() => void saveOffers()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Aprova i desa {doc.brackets.length ? "les ofertes" : ""} al catàleg</Button>
              <Button variant="ghost" onClick={onCancel}>Descarta</Button>
            </div>
            <p className="mt-1 text-[11px] text-muted">Es desa una oferta per modalitat i tram, amb els preus contractuals Open i No Open i els sis preus estimats. Els preus originals no se substitueixen.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Item({ k, v, wide, strong }: { k: string; v: string; wide?: boolean; strong?: boolean }) {
  return <div className={cn(wide && "col-span-2")}><dt className="text-[11px] text-muted">{k}</dt><dd className={cn("break-words", strong ? "text-[15px] font-semibold tnum" : "font-medium")}>{v}</dd></div>;
}

function OpenChat({ conv, tariff, onApply, onSave, isAdmin }: { conv: ReturnType<typeof convertModality>; tariff: string; onApply: (p: ChatProposal) => void; onSave: (p: ChatProposal) => void; isAdmin: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: `Pregunta'm per qualsevol període (p. ex. «Per què el P6 de ${MODALITY_LABEL[conv.modality]} té aquest preu?») o corregeix un horari («Noche és de 0 a 8 de dilluns a divendres i de 0 a 18 els caps de setmana»).` }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs]);
  const ctx: OpenChatContext = {
    tariff, modality: conv.modality, bracketLabel: conv.bracket.label, openPrice: conv.openPrice, noOpenPrice: conv.noOpenPrice, rule: conv.rule.rule, documentRule: conv.documentRule, reference: conv.reference,
    periods: conv.periods.map((p) => ({ period: p.period, open: p.open, noOpen: p.noOpen, total: p.total, price: p.price })),
    discrepancies: conv.discrepancies.map((d) => ({ period: d.period, internalOpen: d.internalOpen, documentOpen: d.documentOpen, diffHours: d.diffHours, internalPrice: d.internalPrice, documentPrice: d.documentPrice })),
  };
  const send = async () => {
    const m = text.trim();
    if (!m) return;
    setText(""); setBusy(true);
    const history = msgs.slice(1).slice(-8).map((x) => ({ role: x.role, text: x.text }));
    setMsgs((x) => [...x, { role: "user", text: m }]);
    try {
      const r = await openApi.chat({ message: m, context: ctx, history });
      setMsgs((x) => [...x, { role: "assistant", text: r.text, proposal: r.proposal }]);
    } catch {
      // sense servidor (o error): respon el motor local del navegador
      const { localAnswer } = await import("@/comparator/open-chat");
      const r = localAnswer(m, ctx);
      setMsgs((x) => [...x, { role: "assistant", text: r.text, proposal: r.proposal }]);
    } finally { setBusy(false); }
  };
  return (
    <section className="flex min-h-[320px] flex-col rounded-2xl border border-line bg-surface p-4" aria-label="Xat del lector">
      <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold"><MessageSquare size={15} className="text-brand" /> Xat de la conversió</h3>
      <div className="max-h-[300px] flex-1 space-y-2 overflow-y-auto pr-1 text-[12.5px]" data-testid="open-chat">
        {msgs.map((m, i) => (
          <div key={i} className={cn("whitespace-pre-wrap rounded-xl px-3 py-2", m.role === "user" ? "ml-8 bg-brand/10" : "mr-8 bg-elevated")}>
            {m.text}
            {m.proposal && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => onApply(m.proposal!)}><Sparkles size={12} /> Recalcula els sis períodes</Button>
                <Button size="sm" variant="primary" onClick={() => onSave(m.proposal!)}><CheckCircle2 size={12} /> {isAdmin ? "Aprova i desa a la biblioteca" : "Proposa-la a Direcció"}</Button>
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input className="input flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Escriu una pregunta o una correcció…" aria-label="Missatge al xat" />
        <Button type="submit" variant="primary" disabled={busy || !text.trim()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}</Button>
      </form>
    </section>
  );
}
