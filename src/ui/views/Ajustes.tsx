"use client";
import { DropArea } from "../components/DropZone";
import { DEFAULT_GROUP_WINDOW, GROUP_WINDOWS } from "@/core/contact-groups";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, FileSpreadsheet, Loader2, RefreshCw, Trash2, Upload, UserPlus, XCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { fmtDateTime, today } from "@/core/dates";
import { THEMES, themeFor } from "@/core/seasons";
import { CRM_FIELDS, DIARIO_FIELDS, FIELD_LABELS, detectHeader, importContracts, pickSheets, type ImportReport, type Mapping, type Sheet } from "@/core/importer";
import { DEFAULT_WEIGHTS, WEIGHT_LABELS } from "@/core/priority";
import type { PriorityWeights, Settings, SourceContract } from "@/core/types";
import { useApp } from "@/data/store";
import { Button, Field, Modal, Notice, Tabs, cn } from "../components/ui";
import type { ManagedUser, NewUser } from "@/data/repo";
import { ROLES, ROLE_LABEL, canManageUsers, isStaff } from "@/core/roles";
import dynamic from "next/dynamic";
import { MailSettings } from "./MailSettings";
import { AccessLinkDialog, type AccessLinkInfo } from "../components/AccessLinkDialog";
import { AutomationSettings } from "./sales/AutomationSettings";
import { ContractingSettings } from "./contracting/Settings";

const EnergyRoot = dynamic(() => import("@/energy/EnergyRoot"), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-2xl bg-elevated" /> });

type Tab = "datos" | "prioridad" | "alertas" | "empresa" | "energia" | "automatitzacions" | "contractacio" | "correu" | "integraciones" | "usuarios";

export function AjustesView() {
  const role = useApp((s) => s.snap!.me.role);
  const param = useApp((s) => s.params.tab) as Tab | undefined;
  const full = canManageUsers(role);
  const staff = isStaff(role);
  const items: { id: Tab; label: string }[] = [
    ...(staff ? ([{ id: "datos", label: "Dades i sincronització" }, { id: "prioridad", label: "Prioritat" }, { id: "alertas", label: "Alertes" }, { id: "empresa", label: "Empresa i PDF" }] as { id: Tab; label: string }[]) : []),
    { id: "energia", label: "Energia i SIPS" },
    ...(staff ? ([{ id: "automatitzacions", label: "Automatitzacions" }, { id: "contractacio", label: "Contractació" }] as { id: Tab; label: string }[]) : []),
    ...(full ? ([{ id: "correu", label: "Correu" }, { id: "integraciones", label: "Integracions" }, { id: "usuarios", label: "Usuaris" }] as { id: Tab; label: string }[]) : []),
  ];
  const tab: Tab = param && items.some((i) => i.id === param) ? param : items[0].id;
  const setTab = (t: Tab) => useApp.getState().navigate("ajustes", { tab: t }, { replace: true });
  return (
    <div className={cn("mx-auto px-4 py-5 sm:px-6", tab === "energia" ? "max-w-[1500px]" : "max-w-4xl")}>
      <Tabs value={tab} onChange={setTab} items={items} />
      <div className="mt-4">
        {tab === "datos" && staff && <Datos />}
        {tab === "prioridad" && staff && <Prioridad />}
        {tab === "alertas" && staff && <Alertas />}
        {tab === "empresa" && staff && <Empresa />}
        {tab === "energia" && <EnergyRoot view="energy-settings" bare />}
        {tab === "automatitzacions" && staff && <AutomationSettings />}
        {tab === "contractacio" && staff && <ContractingSettings />}
        {tab === "correu" && full && <MailSettings />}
        {tab === "integraciones" && full && <Integraciones />}
        {tab === "usuarios" && full && <Usuarios />}
      </div>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <section className="mb-4 rounded-2xl border border-line bg-surface p-4"><h3 className="text-[14px] font-semibold">{title}</h3>{sub && <p className="mb-3 mt-0.5 text-[12.5px] text-muted">{sub}</p>}{!sub && <div className="mb-3" />}{children}</section>;
}

// ---------------- Datos
async function readWorkbook(f: File): Promise<Sheet[]> {
  const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
  return wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) as unknown[][] }));
}

function Datos() {
  const { snap, applyImport, integrations, syncRemote, toast, repo } = useApp();
  const ls = snap!.lastSync;
  const [crm, setCrm] = useState<{ file: string; sheet: Sheet; headers: string[]; mapping: Mapping } | null>(null);
  const [diario, setDiario] = useState<{ file: string; sheets: Sheet[]; headers: string[]; mapping: Mapping } | null>(null);
  const [preview, setPreview] = useState<{ contracts: SourceContract[]; report: ImportReport } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCrm = async (f?: File) => {
    if (!f) return;
    const sheets = await readWorkbook(f);
    const sh = pickSheets(sheets).crm ?? sheets[0];
    const det = detectHeader(sh.rows, CRM_FIELDS);
    setCrm({ file: f.name, sheet: sh, headers: det.headers.filter(Boolean), mapping: det.mapping });
    setPreview(null);
  };
  const loadDiario = async (f?: File) => {
    if (!f) return;
    const sheets = await readWorkbook(f);
    const ds = pickSheets(sheets).diario;
    const use = ds.length ? ds : [sheets[0]];
    const det = detectHeader(use[0].rows, DIARIO_FIELDS);
    setDiario({ file: f.name, sheets: use, headers: det.headers.filter(Boolean), mapping: det.mapping });
    setPreview(null);
  };
  const analyse = () => {
    if (!crm) return;
    setPreview(importContracts({ today: today(), crm: { sheet: crm.sheet, mapping: crm.mapping }, diario: diario ? { sheets: diario.sheets, mapping: diario.mapping } : undefined }));
  };

  return (
    <>
      <Section title="Origen actual" sub="Google Sheets/Drive és la font dels contractes. Els estats, comunicacions, tasques i documents del CRM es desen a part i no es perden mai en sincronitzar.">
        {ls?.report ? (
          <div className="grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
            {[["Files CRM", ls.report.filasCRM], ["Files registre diari", ls.report.filasDiario], ["Contractes únics (per CUPS)", ls.report.contratosUnicos], ["Creuats amb el diari", ls.report.conDiario], ["Data per revisar", ls.report.fechasEstimadas], ["Renovació tàcita", ls.report.tacitas], ["Sense consum", ls.report.sinConsumo], ["Sense CUPS", ls.report.sinCups]].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg bg-elevated px-3 py-2"><div className="text-lg font-semibold tnum">{Number(v).toLocaleString("ca-ES")}</div><div className="text-[11px] text-muted">{k}</div></div>
            ))}
          </div>
        ) : <p className="text-sm text-muted">No hi ha dades importades.</p>}
        {ls && <p className="mt-2 text-[11.5px] text-muted">{ls.origin} · {fmtDateTime(ls.at)}</p>}
        {ls?.error && <div className="mt-2"><Notice tone="red">L'última sincronització ({fmtDateTime(ls.errorAt)}) ha fallat: {ls.error}</Notice></div>}
      </Section>

      <Section title="Sincronització automàtica amb Google" sub="En producció, el servidor llegeix els fulls amb un compte de servei de Google cada dia (cron de Vercel; cada 15 minuts al pla Pro) i sempre que premis «Sincronitza ara».">
        {integrations.googleSync ? (
          <Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { await syncRemote(); } catch (e) { toast({ title: "Error de sincronització", body: String(e), tone: "err" }); } finally { setBusy(false); } }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sincronitza ara
          </Button>
        ) : (
          <Notice tone="blue">No està configurada en aquest entorn. Per activar-la: crea un compte de servei a Google Cloud amb les API de Drive i Sheets, comparteix-hi els dos fulls com a lector (o editor per escriure l'estat de tornada) i defineix <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>, <code>SOURCE_CRM_FILE_ID</code> (o <code>SOURCE_CRM_FOLDER_ID</code>) i <code>SOURCE_DIARIO_FILE_ID</code> a Vercel. Mentrestant, importa els Excel aquí sota.</Notice>
        )}
      </Section>

      <Section title="Importa des d'Excel" sub="Descarrega els fulls de Drive com a .xlsx i puja'ls. Les columnes es detecten automàticament; pots corregir la correspondència abans d'importar. No es creen duplicats: cada CUPS és un contracte.">
        <div className="grid gap-3 sm:grid-cols-2">
          <FilePick label="Exportació del CRM (Contratos_*.xlsx)" file={crm?.file} onPick={loadCrm} required />
          <FilePick label="Registre diari (CONTRACTES PER DIA.xlsx)" file={diario?.file} onPick={loadDiario} />
        </div>
        {crm && <MappingEditor title="Columnes del CRM" fields={CRM_FIELDS} headers={crm.headers} mapping={crm.mapping} onChange={(m) => { setCrm({ ...crm, mapping: m }); setPreview(null); }} />}
        {diario && <MappingEditor title={`Columnes del registre diari (pestanyes ${diario.sheets.map((s) => s.name).join(", ")})`} fields={DIARIO_FIELDS} headers={diario.headers} mapping={diario.mapping} onChange={(m) => { setDiario({ ...diario, mapping: m }); setPreview(null); }} />}
        {crm && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={analyse}>Analitza</Button>
            {preview && (
              <>
                <span className="text-[12.5px] text-muted">{preview.report.contratosUnicos.toLocaleString("ca-ES")} contractes únics de {preview.report.filasCRM.toLocaleString("ca-ES")} files · {preview.report.conDiario.toLocaleString("ca-ES")} creuats amb el diari</span>
                <Button variant="primary" className="ml-auto" disabled={busy} onClick={async () => { setBusy(true); await applyImport(preview.contracts, preview.report, `Excel · ${crm.file}${diario ? ` + ${diario.file}` : ""}`); setBusy(false); setPreview(null); }}>
                  <Upload size={14} /> Importa i conserva la feina del CRM
                </Button>
              </>
            )}
          </div>
        )}
      </Section>

      {repo?.reset && (
        <Section title="Restableix la demo" sub="Esborra els estats, tasques, ofertes i documents desats en aquest navegador i torna a les dades importades originalment.">
          <Button variant="danger" onClick={async () => { if (confirm("Vols esborrar tota la feina desada en aquest navegador?")) { await repo.reset!(); location.reload(); } }}>Restableix</Button>
        </Section>
      )}
    </>
  );
}

function FilePick({ label, file, onPick, required }: { label: string; file?: string; onPick: (f?: File) => void; required?: boolean }) {
  return (
    <DropArea accept=".xlsx,.xls,.csv" onFiles={([f]) => onPick(f)}>
    <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-3 hover:border-brand", file ? "border-brand/50 bg-brand/[0.04]" : "border-line")}>
      <FileSpreadsheet size={22} className={file ? "text-brand" : "text-muted"} />
      <div className="min-w-0 text-[12.5px]"><p className="font-medium">{label}{required && " *"}</p><p className="truncate text-muted">{file ?? "Tria un fitxer .xlsx o arrossega'l aquí"}</p></div>
      <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
    </label>
    </DropArea>
  );
}

function MappingEditor({ title, fields, headers, mapping, onChange }: { title: string; fields: (keyof typeof FIELD_LABELS)[]; headers: string[]; mapping: Mapping; onChange: (m: Mapping) => void }) {
  const found = fields.filter((f) => mapping[f]).length;
  return (
    <details className="mt-3 rounded-xl border border-line" open={found < fields.length / 2}>
      <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-medium">{title} <span className="text-muted">· {found}/{fields.length} camps detectats</span></summary>
      <div className="grid gap-x-4 gap-y-1.5 border-t border-line p-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f} className="grid grid-cols-[1fr_1.2fr] items-center gap-2 text-[12px]">
            <span className="flex items-center gap-1.5">{mapping[f] ? <CheckCircle2 size={12} className="text-ren" /> : <CircleDashed size={12} className="text-muted" />}{FIELD_LABELS[f]}</span>
            <select className="input h-7 py-0 text-[12px]" value={mapping[f] ?? ""} onChange={(e) => onChange({ ...mapping, [f]: e.target.value || undefined })}>
              <option value="">— No fer servir —</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
        ))}
      </div>
    </details>
  );
}

// ---------------- Prioridad
function Prioridad() {
  const { snap, saveSettings } = useApp();
  const s = snap!.settings;
  const [w, setW] = useState<PriorityWeights>(s.pesos);
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return (
    <Section title="Pesos de la prioritat intel·ligent" sub="La puntuació 0–100 de cada contracte és la suma ponderada d'aquests factors. Cada fitxa en mostra el detall perquè sigui explicable.">
      <div className="space-y-3">
        {(Object.keys(WEIGHT_LABELS) as (keyof PriorityWeights)[]).map((k) => (
          <label key={k} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[12.5px] sm:grid-cols-[220px_1fr_60px]">
            <span className="font-medium">{WEIGHT_LABELS[k]}</span>
            <input type="range" min={0} max={50} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="col-span-2 accent-[rgb(var(--brand))] sm:col-span-1" />
            <span className="text-right tnum text-muted max-sm:row-start-1 max-sm:col-start-2">{Math.round((w[k] / total) * 100)}%</span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-muted">Etiquetes: Crítica ≥ 75 · Alta ≥ 55 · Mitjana ≥ 35 · Baixa &lt; 35.</p>
      <div className="mt-3 flex gap-2">
        <Button variant="ghost" onClick={() => setW(DEFAULT_WEIGHTS)}>Valors per defecte</Button>
        <Button variant="primary" className="ml-auto" onClick={() => saveSettings({ ...s, pesos: w })}>Desa i recalcula</Button>
      </div>
    </Section>
  );
}

// ---------------- Alertas
function Alertas() {
  const { snap, saveSettings, toast } = useApp();
  const [s, setS] = useState<Settings>(snap!.settings);
  return (
    <Section title="Alertes i regles de seguiment" sub="Les alertes surten a «El teu pla d'avui» el dia que un contracte arriba a cada llindar.">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Llindars d'alerta (dies)" hint="Separats per comes"><input className="input" defaultValue={s.alertas.join(", ")} onChange={(e) => setS({ ...s, alertas: e.target.value.split(",").map((x) => parseInt(x)).filter((x) => !isNaN(x)).sort((a, b) => b - a) })} /></Field>
        <Field label="Finestra de «Pendents» (dies)" hint="Contractes que entren al Kanban"><input type="number" className="input" value={s.horizonteDias} onChange={(e) => setS({ ...s, horizonteDias: Number(e.target.value) || 90 })} /></Field>
        <Field label="Suggereix seguiment després de (dies)" hint="Sense resposta a una proposta"><input type="number" className="input" value={s.seguimientoDias} onChange={(e) => setS({ ...s, seguimientoDias: Number(e.target.value) || 3 })} /></Field>
        <Field label="Agrupa renovacions del mateix contacte (dies)" hint="Diferència màxima entre el primer i l'últim venciment d'una targeta agrupada. Cada usuari la pot canviar al Kanban.">
          <select className="input" value={s.agrupacioDies ?? DEFAULT_GROUP_WINDOW} onChange={(e) => setS({ ...s, agrupacioDies: Number(e.target.value) })}>{GROUP_WINDOWS.map((w) => <option key={w} value={w}>{w} dies</option>)}</select>
        </Field>
      </div>
      <div className="mt-3 flex justify-end"><Button variant="primary" onClick={async () => { await saveSettings(s); toast({ title: "Regles desades", tone: "ok" }); }}>Desa</Button></div>
    </Section>
  );
}

// ---------------- Empresa
function Empresa() {
  const { snap, saveSettings, toast } = useApp();
  const [s, setS] = useState<Settings>(snap!.settings);
  const e = s.empresa;
  const setE = (k: keyof Settings["empresa"], v: string) => setS({ ...s, empresa: { ...e, [k]: v } });
  return (
    <>
      <Section title="Dades de contacte d'Assessoria 3.0" sub="Surten a les propostes PDF i a les plantilles ({{empresa}}, {{telefono_empresa}}).">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom"><input className="input" value={e.nombre} onChange={(x) => setE("nombre", x.target.value)} /></Field>
          <Field label="Telèfon"><input className="input" value={e.telefono} onChange={(x) => setE("telefono", x.target.value)} /></Field>
          <Field label="Correu electrònic"><input className="input" value={e.email} onChange={(x) => setE("email", x.target.value)} /></Field>
          <Field label="Web"><input className="input" value={e.web} onChange={(x) => setE("web", x.target.value)} /></Field>
          <div className="sm:col-span-2"><Field label="Adreça"><input className="input" value={e.direccion} onChange={(x) => setE("direccion", x.target.value)} /></Field></div>
          <Field label="Logotip (PNG/JPG)" hint="Per defecte es fa servir el logotip oficial d'Assessoria 3.0. Puja'n un altre només si el vols substituir al PDF.">
            <DropArea accept="image/png,image/jpeg,.png,.jpg,.jpeg" onFiles={([f]) => { const r = new FileReader(); r.onload = () => setS({ ...s, logo: String(r.result) }); r.readAsDataURL(f); }}>
            <input type="file" accept="image/png,image/jpeg" className="input" onChange={(x) => { const f = x.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setS({ ...s, logo: String(r.result) }); r.readAsDataURL(f); }} />
            </DropArea>
          </Field>
          {s.logo && <div className="flex items-end gap-2"><img src={s.logo} alt="Logo" className="h-12 rounded bg-brand p-1" /><Button size="sm" variant="ghost" onClick={() => setS({ ...s, logo: null })}>Treu</Button></div>}
        </div>
      </Section>
      <Section title="Objectius comercials" sub="Es mostren al Dashboard executiu. Deixa-ho en blanc si no vols fer-ne seguiment.">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Renovacions objectiu per mes"><input className="input tnum" inputMode="numeric" value={s.objetivoRenovacionesMes ?? ""} onChange={(x) => setS({ ...s, objetivoRenovacionesMes: x.target.value.trim() === "" ? null : Math.max(0, Number(x.target.value.replace(/\D/g, "")) || 0) })} /></Field>
        </div>
      </Section>
      <Section title="Hipòtesis de càlcul" sub="Es mostren sempre a la comparativa i al PDF. Revisa-les quan canviï la normativa.">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Impost elèctric (%)"><input className="input tnum" value={s.iee} onChange={(x) => setS({ ...s, iee: Number(x.target.value.replace(",", ".")) || 0 })} /></Field>
          <Field label="IVA (%)"><input className="input tnum" value={s.iva} onChange={(x) => setS({ ...s, iva: Number(x.target.value.replace(",", ".")) || 0 })} /></Field>
          <Field label="Lloguer comptador (€/mes)"><input className="input tnum" value={s.alquilerContadorMes} onChange={(x) => setS({ ...s, alquilerContadorMes: Number(x.target.value.replace(",", ".")) || 0 })} /></Field>
          <Field label="Validesa de l'oferta (dies)"><input className="input tnum" value={s.validezOfertaDias} onChange={(x) => setS({ ...s, validezOfertaDias: Number(x.target.value) || 15 })} /></Field>
        </div>
      </Section>
      <div className="flex justify-end"><Button variant="primary" onClick={async () => { await saveSettings(s); toast({ title: "Configuració desada", tone: "ok" }); }}>Desa</Button></div>
      <div className="mt-4"><Ambientacion /></div>
    </>
  );
}

function Ambientacion() {
  const { ambient, themePreview, set, ambientRun } = useApp();
  const current = themeFor(today());
  return (
    <Section title="Ambientació de temporada" sub={`Decoració i animació segons el calendari: festes catalanes (Reis, Carnaval, Pasqua, Sant Jordi, Sant Joan, Diada, Castanyada, Tió, Nadal, Cap d'Any…) i les quatre estacions. Avui: ${current.icon} ${current.name}. És una preferència d'aquest navegador.`}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={ambient} onChange={(e) => { set("ambient", e.target.checked); try { localStorage.setItem("rip:ambient", e.target.checked ? "on" : "off"); } catch { /* ignore */ } }} />
          Mostra l'ambientació
        </label>
        <Field label="Previsualitza una altra temporada">
          <select className="input h-9 w-auto" value={themePreview ?? ""} onChange={(e) => { set("themePreview", e.target.value || null); set("ambientRun", ambientRun + 1); }}>
            <option value="">Automàtica (segons la data)</option>
            {Object.values(THEMES).map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
          </select>
        </Field>
        <Button onClick={() => set("ambientRun", ambientRun + 1)} disabled={!ambient}>Mostra l'animació</Button>
      </div>
    </Section>
  );
}

// ---------------- Integraciones
function Integraciones() {
  const { integrations, repo } = useApp();
  const [health, setHealth] = useState<Record<string, { ok: boolean; detail: string }> | null>(null);
  const [loading, setLoading] = useState(false);
  const canCheck = typeof location !== "undefined" && location.protocol.startsWith("http") && repo?.variant !== "demo";
  const check = async () => {
    setLoading(true);
    try { const r = await fetch("/api/health", { cache: "no-store" }); setHealth((await r.json()).checks); } catch { setHealth(null); } finally { setLoading(false); }
  };
  useEffect(() => { if (canCheck) void check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const LABELS: Record<string, string> = {
    supabase_env: "Supabase: variables", supabase_schema: "Supabase: taules (migració)", supabase_admin: "Supabase: primer administrador",
    google: "Google Drive (sincronització)", smtp: "Correu corporatiu (SMTP)", ai: "IA (ANTHROPIC_API_KEY)", cron: "Sincronització diària (CRON_SECRET)",
    comparatives: "Comparatives IA (migració 006)", invoice_ai: "Lectura de factures amb IA (INVOICE_AI_ENABLED)",
    sips: "Portal SIPS (SIPS_USER / SIPS_PASSWORD)", calendar_google: "Google Calendar (OAuth)", calendar_microsoft: "Outlook / Microsoft 365 (OAuth)",
  };
  return (
    <>
      {canCheck && (
        <Section title="Diagnòstic del servidor" sub="Comprova en directe què hi ha configurat a Vercel. La IA, la sincronització amb Google, el correu i els usuaris necessiten que Supabase estigui configurat i que hagis iniciat sessió.">
          {health ? (
            <ul className="divide-y divide-line">
              {Object.entries(health).map(([k, v]) => (
                <li key={k} className="flex items-start gap-3 py-2.5 text-[12.5px]">
                  {v.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ren" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-lost" />}
                  <div><p className="font-medium">{LABELS[k] ?? k}</p><p className="text-muted">{v.detail}</p></div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">{loading ? "Comprovant…" : "No s'ha pogut obtenir el diagnòstic."}</p>}
          <div className="mt-2 flex justify-end"><Button size="sm" onClick={check} disabled={loading}><RefreshCw size={13} className={cn(loading && "animate-spin")} /> Torna a comprovar</Button></div>
        </Section>
      )}
      {canCheck && <SipsPanel />}
      <Section title="Funcions actives en aquesta sessió" sub="No se simula cap integració: si falta alguna cosa, la funció surt desactivada amb una alternativa manual.">
        <ul className="divide-y divide-line">
          {([["supabase", "Base de dades i usuaris"], ["googleSync", "Sincronització amb Google"], ["smtp", "Enviament de correu"], ["ai", "Assistent i missatges amb IA"], ["whatsappCloud", "WhatsApp Business Platform (fase 2)"]] as const).map(([k, label]) => (
            <li key={k} className="flex items-center gap-3 py-2 text-[12.5px]">
              {integrations[k] ? <CheckCircle2 size={16} className="text-ren" /> : <CircleDashed size={16} className="text-muted" />}
              <span className="flex-1 font-medium">{label}</span>
              <span className={cn("text-[11.5px]", integrations[k] ? "text-ren" : "text-muted")}>{integrations[k] ? "Activa" : "Inactiva"}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function Usuarios() {
  const { snap, repo, contracts, toast } = useApp();
  const [access, setAccess] = useState<AccessLinkInfo | null>(null);
  const [list, setList] = useState<ManagedUser[] | null>(null);
  const [form, setForm] = useState<NewUser & { mode: "password" | "invite" }>({ name: "", email: "", role: "comercial", code: "", password: "", mode: "password" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const codes = useMemo(() => [...new Set(contracts.flatMap((c) => [c.comercial, c.captador ?? ""]).filter((c) => c && c !== "SIN ASIGNAR"))].sort(), [contracts]);
  const refresh = async () => {
    if (!repo?.listUsers) return;
    try { const l = await repo.listUsers(); setList(l); useApp.setState({ snap: { ...useApp.getState().snap!, users: l } }); }
    catch (e) { toast({ title: "No s'ha pogut carregar la llista d'usuaris", body: e instanceof Error ? e.message : String(e), tone: "err" }); setList([]); }
  };
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const genPass = () => setForm({ ...form, password: Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 56]).join("") });
  const create = async () => {
    if (!repo?.createUser) return;
    setBusy(true);
    try {
      const u = await repo.createUser({ name: form.name.trim(), email: form.email.trim(), role: form.role, code: form.code?.trim().toUpperCase() || null, password: form.mode === "password" ? form.password : undefined });
      toast({ title: "Usuari creat", body: u.invited ? (u.emailSent ? `S'ha enviat l'enllaç d'accés a ${u.email}` : "Copia l'enllaç d'accés i envia-l'hi") : `${u.email} ja pot entrar amb la contrasenya indicada`, tone: "ok" });
      if (u.invited && u.link) setAccess({ email: u.email, link: u.link, emailSent: !!u.emailSent, emailError: u.emailError ?? null });
      setOpen(false);
      setForm({ name: "", email: "", role: "comercial", code: "", password: "", mode: "password" });
      await refresh();
    } catch (e) { toast({ title: "No s'ha pogut crear l'usuari", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(false); }
  };
  const update = async (id: string, patch: Partial<NewUser> & { suspended?: boolean }) => {
    try { await repo!.updateUser!(id, patch); await refresh(); toast({ title: "Usuari actualitzat", tone: "ok" }); }
    catch (e) { toast({ title: "No s'ha pogut actualitzar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  const remove = async (u: ManagedUser) => {
    if (!confirm(`Vols eliminar ${u.name} (${u.email})? El seu historial es conserva.`)) return;
    try { await repo!.deleteUser!(u.id); await refresh(); toast({ title: "Usuari eliminat", tone: "ok" }); }
    catch (e) { toast({ title: "No s'ha pogut eliminar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  const valid = form.name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email) && (form.role !== "comercial" || form.code?.trim()) && (form.mode === "invite" || (form.password ?? "").length >= 8);
  return (
    <Section title="Usuaris i accés" sub="Rols: Direcció (DIRECCIO, mateixos drets per a totes les persones de Direcció), Cap administrativa, Administrativa, Comercial i Col·laborador (només el portal /collaboradors). Aquí es donen d'alta les persones i se'ls assigna el rol; els permisos detallats per mòdul (lectura, edició, aprovació) i les excepcions per persona es configuren a Configuració → Usuaris i permisos. Cada canvi queda auditat.">
      <AccessLinkDialog info={access} onClose={() => setAccess(null)} />
      {repo?.variant === "unconfigured" && <div className="mb-3"><Notice>Per crear usuaris reals cal Supabase. Revisa la pestanya Integracions.</Notice></div>}
      {repo?.variant === "demo" && <div className="mb-3"><Notice tone="blue">Mode demo: els usuaris només es creen en aquest navegador per provar els permisos.</Notice></div>}
      <div className="mb-3 flex justify-end"><Button variant="primary" disabled={!repo?.createUser || repo.variant === "unconfigured"} onClick={() => setOpen(true)}><UserPlus size={14} /> Nou usuari</Button></div>
      {list === null ? <p className="text-sm text-muted">Carregant…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-[11.5px] text-muted"><th className="py-1.5 pr-2 font-medium">Usuari</th><th className="px-2 font-medium">Rol</th><th className="px-2 font-medium">Codi comercial</th><th className="px-2 font-medium">Últim accés</th><th className="px-2 font-medium">Accés</th><th /></tr></thead>
            <tbody>{list.map((u) => (
              <tr key={u.id} className="border-t border-line/60">
                <td className="py-2 pr-2"><div className="flex items-center gap-2.5"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand">{u.name.slice(0, 2).toUpperCase()}</span><div><p className="font-medium">{u.name}{u.id === snap!.me.id && <span className="text-muted"> (tu)</span>}</p><p className="text-[11px] text-muted">{u.email}</p></div></div></td>
                <td className="px-2"><select className="input h-8 w-auto py-0" value={u.role} disabled={u.id === snap!.me.id} onChange={(e) => update(u.id, { role: e.target.value as NewUser["role"] })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td>
                <td className="px-2"><input className="input h-8 w-44 py-0 uppercase" list="codes" defaultValue={u.code ?? ""} onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (v !== (u.code ?? "")) update(u.id, { code: v || null }); }} /></td>
                <td className="px-2 text-muted">{u.lastSignIn ? fmtDateTime(u.lastSignIn) : u.invited ? "Convidat" : "—"}</td>
                <td className="px-2 text-[11.5px]">{u.suspended ? <span className="text-red-600">Suspès</span> : <span className="text-emerald-600">Actiu</span>}{u.mfa ? <span className="ml-1 text-muted">· MFA</span> : null}{u.id !== snap!.me.id && <button className="ml-2 text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => { if (confirm(u.suspended ? `Reactivar l'accés de ${u.name}?` : `Suspendre l'accés de ${u.name}? No s'esborra cap dada i es pot reactivar.`)) void update(u.id, { suspended: !u.suspended }); }}>{u.suspended ? "Reactiva" : "Suspèn"}</button>}</td>
                <td className="px-2 text-right">{u.id !== snap!.me.id && <Button size="sm" variant="ghost" aria-label="Elimina" onClick={() => remove(u)}><Trash2 size={13} /></Button>}</td>
              </tr>
            ))}</tbody>
          </table>
          <datalist id="codes">{codes.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Nou usuari"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel·la</Button><Button variant="primary" disabled={!valid || busy} onClick={create}>{busy && <Loader2 size={14} className="animate-spin" />} Crea l'usuari</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Correu electrònic"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Rol"><select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as NewUser["role"] })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
          <Field label={form.role === "comercial" ? "Codi comercial (obligatori)" : form.role === "colaborador" ? "Codi de col·laborador" : "Codi (opcional)"} hint={form.role === "colaborador" ? "El nom de la columna admin (p. ex. COL. ANTONIO FINQUES). Si el seu correu és el «Usuari propietari» del CRM, també veurà aquells contractes." : "El nom que surt a ADMIN GESTIONO, p. ex. IBETH"}>
            <input className="input uppercase" list="codes" value={form.code ?? ""} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <span className="label">Accés</span>
            <div className="flex gap-1.5">
              <button onClick={() => setForm({ ...form, mode: "password" })} className={cn("pressable rounded-full border px-3 py-1 text-[12px]", form.mode === "password" ? "border-brand bg-brand/10 font-medium text-brand" : "border-line")}>Defineix la contrasenya</button>
              <button onClick={() => setForm({ ...form, mode: "invite" })} disabled={repo?.mode === "demo"} className={cn("pressable rounded-full border px-3 py-1 text-[12px] disabled:opacity-40", form.mode === "invite" ? "border-brand bg-brand/10 font-medium text-brand" : "border-line")}>Envia una invitació per correu</button>
            </div>
          </div>
          {form.mode === "password" && (
            <div className="sm:col-span-2"><Field label="Contrasenya (mín. 8 caràcters)" hint="Comparteix-la amb l'usuari per un canal segur.">
              <div className="flex gap-2"><input className="input font-mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><Button onClick={genPass}>Genera</Button></div>
            </Field></div>
          )}
        </div>
      </Modal>
    </Section>
  );
}

/** Estat del SIPS i prova de connexió real (només Direcció i Administració). Mai mostra credencials. */
function SipsPanel() {
  const [st, setSt] = useState<{ configured: boolean; missing?: string[]; staff: boolean; ttlDays: number } | null>(null);
  const [test, setTest] = useState<{ ok: boolean; code: string; message: string; base: string; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/sips/status", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setSt).catch(() => setSt(null)); }, []);
  if (!st?.staff) return null;
  const run = async () => {
    setBusy(true);
    try { const r = await fetch("/api/sips/status", { method: "POST" }); const j = await r.json(); setTest(r.ok ? j : { ok: false, code: "error", message: j.error ?? `Error ${r.status}`, base: "", ms: 0 }); }
    catch { setTest({ ok: false, code: "xarxa", message: "No hi ha connexió amb el servidor.", base: "", ms: 0 }); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Connexió SIPS" sub="Portal SIPS (EAS Renovae). Les credencials només viuen al servidor (Vercel); el navegador no les veu mai.">
      <ul className="space-y-1.5 text-[12.5px]">
        <li className="flex items-center gap-2">{st.configured ? <CheckCircle2 size={15} className="text-ren" /> : <XCircle size={15} className="text-lost" />}{st.configured ? "Credencials configurades al servidor" : `Falten variables a Vercel: ${(st.missing ?? ["SIPS_USER", "SIPS_PASSWORD"]).join(", ")}`}</li>
        <li className="text-muted">Les dades consultades es guarden {st.ttlDays} dies (SIPS_TTL_DAYS). Opcional: SIPS_BASE_URL si el portal canvia d&apos;adreça.</li>
        {test && <li className={cn("rounded-lg px-2.5 py-2", test.ok ? "bg-ren/10 text-ren" : "bg-lost/10 text-lost")} role="status">{test.message}{test.ms ? ` (${test.ms} ms${test.base ? ` · ${test.base}` : ""})` : ""}</li>}
      </ul>
      <div className="mt-2 flex justify-end"><Button size="sm" onClick={run} disabled={busy}><RefreshCw size={13} className={cn(busy && "animate-spin")} /> Prova la connexió</Button></div>
    </Section>
  );
}
