"use client";
import { useRouter, useSearchParams } from "@/energy/compat/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, CheckSquare, DatabaseZap, KeyRound, Loader2, PlusCircle, Search, Square, Briefcase } from "lucide-react";
import { toast } from "@/energy/compat/toast";
import { useStore } from "@/energy/lib/store";
import { parseRows, annualActive, maxContracted } from "@/energy/lib/parse";
import { validateCups } from "@/energy/lib/cups";
import { TARIFFS } from "@/energy/lib/tariffs";
import { TARIFAS_GAS, type EnergyFilter } from "@/energy/lib/sips-engine";
import { isGasSupply } from "@/energy/lib/sips-record";
import type { RawCell } from "@/energy/lib/xlsx";
import { energyApi, serverEnabled, type SipsResult, type SipsStatus } from "@/energy/api";
import type { SearchInput as SipsQuery } from "@/energy/lib/sips-engine";
import { cupsBase } from "@/energy/lib/sips-record";
import { useApp } from "@/data/store";
import { cn, fmt } from "@/energy/lib/format";
import { Badge, Button, Callout, Card, Empty, Field, Input, NumInput, Select } from "@/energy/components/ui";
import { PageTitle } from "@/energy/components/shell";

const ERR_TITLE: Record<string, string> = { no_configurat: "SIPS no configurat", credencials: "Credencials SIPS incorrectes", no_disponible: "Servei SIPS no disponible", cups_invalid: "CUPS no vàlid", sense_permisos: "Sense permís", limit: "Límit de consultes", transformacio: "Error de dades del portal", sessio: "Sessió caducada", consulta: "Error de consulta" };

export function SipsView() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-surface" />}>
      <SipsSearch />
    </Suspense>
  );
}

const PER = 50;

function SipsSearch() {
  const params = useSearchParams();
  const router = useRouter();
  const hydrated = useStore((s) => s.hydrated);
  const contracts = useApp((s) => s.contracts);
  const crmByBase = useMemo(() => new Map(contracts.filter((c) => c.cups).map((c) => [cupsBase(c.cups), c])), [contracts]);
  const importRows = useStore((s) => s.importRows);
  const supplies = useStore((s) => s.supplies);
  const inPortfolio = useMemo(() => new Set(supplies.filter((x) => !x.source.demo).map((x) => x.cups)), [supplies]);
  const [status, setStatus] = useState<SipsStatus | null>(null);
  const [mode, setMode] = useState<"cups" | "zona">("cups");
  const [energia, setEnergia] = useState<EnergyFilter>("totes");
  const [cups, setCups] = useState(params.get("cups") ?? "");
  const [cp, setCp] = useState("");
  const [dir, setDir] = useState("");
  const [tarifa, setTarifa] = useState("");
  const [minKWh, setMinKWh] = useState<number | null>(null);
  const [res, setRes] = useState<SipsResult | null>(null);
  const [query, setQuery] = useState<SipsQuery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [link, setLink] = useState<{ busy: boolean; crm: { id: string; client_id: string; name: string | null; data_updated_at: string; data_source: string }[] | null; done: string | null }>({ busy: false, crm: null, done: null });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const auto = useRef(false);

  useEffect(() => {
    if (!serverEnabled()) {
      setStatus({ available: false, configured: false, credentials: false, external: false, ttlDays: 7, staff: false });
      return;
    }
    energyApi.status().then(setStatus).catch((e: Error & { status?: number }) => {
      // Fase 8: s'explica el motiu real (sessió caducada, MFA, sense permís…) en lloc d'un «no configurat» genèric
      setStatusError(e.status === 401 ? "La sessió ha caducat: torna a iniciar sessió." : e.message);
      setStatus({ available: true, configured: false, credentials: false, external: false, ttlDays: 7, staff: false });
    });
  }, []);

  const parsed = useMemo(() => (res ? parseRows(res.rows, { file: `Portal SIPS · ${fmt.dateTime(res.consultedAt)}`, sheet: "Consulta en vivo", importedAt: res.consultedAt }) : null), [res]);

  async function run(q: SipsQuery) {
    setBusy(true);
    setError(null);
    try {
      const r = await energyApi.search(q);
      setRes(r);
      setQuery(q);
      setSel(new Set());
      setLink({ busy: false, crm: null, done: null });
      if (r.total === 0) toast("Sense resultats al portal SIPS");
      // CUPS concret: es mira si pertany a un subministrament del CRM per poder-hi vincular les dades
      if (q.cups && r.total > 0) energyApi.supply(cupsBase(q.cups)).then((x) => setLink({ busy: false, done: null, crm: (x.crmSupplies ?? []).map((c) => ({ id: c.id, client_id: c.client_id, name: c.crm_clients?.name ?? null, data_updated_at: c.data_updated_at, data_source: c.data_source })) })).catch(() => undefined);
    } catch (e) {
      setError({ message: (e as Error).message, code: (e as { code?: string }).code });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!auto.current && hydrated && params.get("cups")) {
      auto.current = true;
      run({ cups: params.get("cups")! });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "cups") {
      const v = validateCups(cups);
      if (!v.valid) {
        setError({ message: `CUPS: ${v.reason}. Introdueix els 20 caràcters base o el CUPS complet de 22.`, code: "cups_invalid" });
        return;
      }
      run({ cups, energia, take: 20 });
    } else run({ cp, energia, direccion: dir, tarifa: tarifa || undefined, minKWh: minKWh ?? undefined, skip: 0, take: PER });
  }

  function add(rows: RawCell[][], open?: string) {
    if (!res) return;
    const rep = importRows([res.rows[0], ...rows], { file: `Portal SIPS · ${fmt.dateTime(res.consultedAt)}`, sheet: "Consulta en vivo", origin: "portal" }, "merge");
    if (open) {
      const c = crmByBase.get(cupsBase(open));
      useApp.getState().analyzeCups(open, c?.id ?? null);
      // l'origen és el buscador: «Tornar» ha de tornar aquí
      useApp.setState({ returnTo: { view: "sips", params: {}, contractId: c?.id ?? null, label: "Tornar al buscador" } });
    } else toast.success(`${rep.imported} subministrament(s) afegits a l'anàlisi energètica`);
    void router;
  }
  const rowFor = (c: string) => res!.rows.slice(1).filter((r) => String(r[1]).toUpperCase().replace(/\s/g, "") === c);

  return (
    <div className="space-y-5">
      <PageTitle icon={<DatabaseZap />} title="Buscador SIPS" subtitle="Consulta en viu del Sistema d'Informació de Punts de Subministrament (portal EAS Renovae)" right={status && <Badge tone={status.configured ? "good" : "warning"}>{status.available ? (status.configured ? "Credencials configurades" : "Pendent de configurar") : "Requereix Supabase"}</Badge>} />

      {status && !status.available && <Callout tone="warning" title="Cal el servidor de la plataforma">El buscador consulta el portal des del servidor amb la sessió de l'usuari. Configura Supabase en aquest desplegament.</Callout>}
      {status?.available && !status.configured && (
        <Callout tone="warning" title="Falta configuració al servidor">
          Afegeix <b>SIPS_USER</b> i <b>SIPS_PASSWORD</b> a Vercel → Settings → Environment Variables (Production i Preview) i torna a desplegar.
        </Callout>
      )}
      {status?.available && !status.external && (
        <Callout tone="info" title="Consulta limitada als teus contractes">
          Pots buscar els CUPS dels contractes que tens assignats. La cerca per adreça i de subministraments externs està reservada als rols autoritzats.
        </Callout>
      )}

      <Card className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative mb-4 flex gap-2">
          {(
            [
              ["cups", "Per CUPS"],
              ["zona", "Per codi postal i adreça"],
            ] as const
          ).filter(([k]) => k === "cups" || status?.external !== false).map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} className={cn("rounded-lg border px-3 py-1.5 text-sm", mode === k ? "border-accent bg-accent/10 text-fg" : "border-border text-fg-3 hover:text-fg")}>
              {l}
            </button>
          ))}
        </div>
        <div className="relative mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-fg-3">Energia:</span>
          {(
            [
              ["totes", "Llum i gas"],
              ["luz", "Llum"],
              ["gas", "Gas"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setEnergia(k);
                setTarifa("");
              }}
              className={cn("rounded-full border px-3 py-1", energia === k ? "border-accent bg-accent/10 text-fg" : "border-border text-fg-3 hover:text-fg")}
            >
              {l}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="relative grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {mode === "cups" ? (
            <Field label="CUPS de llum o de gas (amb o sense sufix)" className="sm:col-span-2 lg:col-span-5">
              <Input value={cups} onChange={(e) => setCups(e.target.value)} placeholder="ES0031…" className="num h-11 text-base" autoFocus />
            </Field>
          ) : (
            <>
              <Field label="Codi postal *">
                <Input value={cp} onChange={(e) => setCp(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="08201" className="num" />
              </Field>
              <Field label="Adreça (conté)" className="lg:col-span-2">
                <Input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Carrer, número…" />
              </Field>
              <Field label="Tarifa">
                <Select value={tarifa} onChange={(e) => setTarifa(e.target.value)}>
                  <option value="">Totes</option>
                  {energia !== "gas" && TARIFFS.map((t) => <option key={t}>{t}</option>)}
                  {energia !== "luz" && TARIFAS_GAS.map((t) => <option key={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Consum mínim (kWh/any)">
                <NumInput value={minKWh} onChange={setMinKWh} placeholder="p. ex. 50000" />
              </Field>
            </>
          )}
          <Button type="submit" size="lg" disabled={busy || !status?.configured}>
            {busy ? <Loader2 className="animate-spin" /> : <Search />} {busy ? "Consultant…" : "Buscar"}
          </Button>
        </form>
        {!busy && !status?.configured && status && <p className="relative mt-2 text-[12px] text-warning" role="status">El botó està desactivat perquè {statusError ? `no s'ha pogut comprovar l'estat del buscador (${statusError})` : "falten les credencials SIPS al servidor (SIPS_USER i SIPS_PASSWORD)"}.</p>}
        {busy && <p className="relative mt-2 text-[12px] text-fg-3" role="status">Consultant el portal SIPS… (màxim uns 25 segons)</p>}
        <p className="relative mt-3 text-[11px] text-fg-3">Busca punts de llum i de gas amb els 20 caràcters base (sense 0F ni cap altre sufix) o amb els 22 complets, en majúscules o minúscules. També pots cercar per codi postal i adreça. Resultats ordenats per consum anual.</p>
      </Card>

      {statusError && <Callout tone="warning" title="No s'ha pogut comprovar el buscador">{statusError}</Callout>}
      {error && <Callout tone={error.code === "limit" || error.code === "sense_resultats" ? "warning" : "critical"} title={ERR_TITLE[error.code ?? ""] ?? "No s'ha pogut fer la consulta"}>{error.message}</Callout>}
      {link.crm && link.crm.length > 0 && res && (
        <Callout tone="info" title="Aquest CUPS és d'un subministrament del CRM">
          <div className="flex flex-wrap items-center gap-2">
            <span>{link.crm.map((c) => c.name ?? "Client").join(", ")} · dades actuals: {link.crm[0].data_source === "sips" ? "SIPS" : link.crm[0].data_source} ({fmt.dateTime(link.crm[0].data_updated_at)}).</span>
            <Button size="sm" disabled={link.busy} onClick={async () => {
              setLink({ ...link, busy: true });
              try { const r = await energyApi.link(cupsBase(query?.cups ?? "")); setLink({ ...link, busy: false, done: `Desat al CRM: ${r.fields.join(", ") || "sense camps nous"} · consulta SIPS del ${fmt.dateTime(r.consultedAt)}` }); toast.success("Dades SIPS desades al subministrament del CRM"); }
              catch (e) { setLink({ ...link, busy: false }); setError({ message: (e as Error).message, code: (e as { code?: string }).code }); }
            }}>{link.busy ? <Loader2 className="animate-spin" /> : <PlusCircle />} Desa-ho al subministrament del CRM</Button>
            {link.done && <span className="text-[12px] text-good">{link.done}</span>}
          </div>
        </Callout>
      )}

      {parsed && res && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {parsed.supplies.length === 0 ? (
            <Empty icon={<Search />} title="Sense resultats">
              El portal SIPS no retorna cap subministrament amb aquestes dades. Revisa el CUPS o amplia la cerca (una altra adreça o sense filtre de tarifa).
            </Empty>
          ) : (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="text-sm">
                  <b className="num">{fmt.n(res.total)}</b> <span className="text-fg-3">resultats · {res.source} · consultat {fmt.dateTime(res.consultedAt)}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={!sel.size} onClick={() => add([...sel].flatMap(rowFor))}>
                    <PlusCircle /> Afegeix a l'anàlisi ({sel.size})
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => add(res.rows.slice(1))}>
                    <PlusCircle /> Afegeix-los tots ({parsed.supplies.length})
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-3">
                    <tr>
                      <th className="w-10 px-3 py-2.5" />
                      <th className="px-3 py-2.5 text-left">Subministrament</th>
                      <th className="px-3 py-2.5 text-left">Tarifa</th>
                      <th className="px-3 py-2.5 text-left">Comercialitzadora</th>
                      <th className="px-3 py-2.5 text-right">Consum</th>
                      <th className="px-3 py-2.5 text-right">Pot. màx.</th>
                      <th className="px-3 py-2.5 text-right">Últ. lectura</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.supplies.map((s) => {
                      const on = sel.has(s.cups);
                      return (
                        <tr key={s.cups} className="border-t border-border hover:bg-surface-2/50">
                          <td className="px-3 py-2.5">
                            <button aria-label="Seleccionar" onClick={() => setSel((p) => (p.has(s.cups) ? new Set([...p].filter((x) => x !== s.cups)) : new Set([...p, s.cups])))} className="text-fg-3 hover:text-accent">
                              {on ? <CheckSquare className="size-4 text-accent" /> : <Square className="size-4" />}
                            </button>
                          </td>
                          <td className="max-w-[340px] px-3 py-2.5">
                            <div className="truncate font-medium">{s.direccion ?? "—"}</div>
                            <div className="num truncate text-[11px] text-fg-3">
                              {s.cups} · {s.cp} {s.localidad}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge tone={isGasSupply(s) ? "serious" : "blue"}>
                              {isGasSupply(s) ? "Gas · " : ""}
                              {s.tarifa ?? s.tarifaRaw ?? "—"}
                            </Badge>
                          </td>
                          <td className="max-w-[180px] truncate px-3 py-2.5 text-xs text-fg-2">{s.comercializadora ?? "—"}</td>
                          <td className="num whitespace-nowrap px-3 py-2.5 text-right">{fmt.n((annualActive(s).value ?? 0) / 1000, 1)} MWh</td>
                          <td className="num whitespace-nowrap px-3 py-2.5 text-right">{fmt.kw(maxContracted(s))}</td>
                          <td className="num whitespace-nowrap px-3 py-2.5 text-right text-xs">{fmt.date(s.fUltLectura)}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right">
                            {crmByBase.has(cupsBase(s.cups)) && (
                              <Badge tone="good" className="mr-2" title={crmByBase.get(cupsBase(s.cups))!.cliente}>
                                <Briefcase /> Al CRM
                              </Badge>
                            )}
                            {inPortfolio.has(s.cups) && <Badge tone="accent" className="mr-2">En cartera</Badge>}
                            <Button size="sm" onClick={() => add(rowFor(s.cups), s.cups)}>
                              Radiografia <ArrowRight />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {query?.cups && parsed.supplies.filter((s) => !isGasSupply(s)).map((s) => {
                const count = s.tarifa === "2.0TD" ? 3 : 6;
                const reading = res.annualConsumptions?.[s.cups];
                const periods = reading?.status === "complete" ? reading.periods : null;
                const total = reading?.status === "complete" ? reading.total : null;
                return (
                  <div key={`periods-${s.cups}`} className="border-t border-border px-4 py-4">
                    <div className="mb-2 text-sm font-semibold">Consum anual per períodes · {s.cups}</div>
                    {periods ? (
                      <div className="max-w-xl space-y-2">
                        {periods.map((kwh, i) => (
                          <div key={i} className="flex items-center gap-3 text-xs">
                            <span className="w-7 font-medium">P{i + 1}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                              <div className="h-full rounded-full bg-accent" style={{ width: `${total ? 100 * kwh / total : 0}%` }} />
                            </div>
                            <span className="num w-32 text-right">{fmt.n(kwh)} kWh</span>
                          </div>
                        ))}
                        <div className="pt-1 text-sm font-semibold">Total: {fmt.n(total)} kWh/any</div>
                        {reading?.warning && <p className="text-xs text-warning">{reading.warning} Diferència: {fmt.n(reading.difference)} kWh.</p>}
                        <div className="text-[11px] text-fg-3">Font: {reading?.source} · del {reading?.from} al {reading?.to} · últim consum {reading?.lastAvailable ?? "—"}</div>
                      </div>
                    ) : (
                      <p className="text-xs text-fg-3">{reading?.warning ?? `Històric incomplet: encara no s’ha rebut el detall «Consumo Punto Suministro» (P1–P${count}).`} Consum anual total: {s.eaAnual == null ? "no disponible" : `${fmt.n(s.eaAnual)} kWh`}. Per a comparatives per períodes, cal una factura o una corba de càrrega real.</p>
                    )}
                  </div>
                );
              })}
              {query && query.cp && res.total > PER && (
                <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-fg-3">
                  <span>
                    {fmt.n((query.skip ?? 0) + 1)}–{fmt.n(Math.min(res.total, (query.skip ?? 0) + PER))} de {fmt.n(res.total)}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={busy || !query.skip} onClick={() => run({ ...query, skip: Math.max(0, (query.skip ?? 0) - PER) })}>
                      Anterior
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy || (query.skip ?? 0) + PER >= res.total} onClick={() => run({ ...query, skip: (query.skip ?? 0) + PER })}>
                      Siguiente
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </motion.div>
      )}
      {!res && !busy && (
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["1", "Busca", "Per CUPS de llum o de gas, amb o sense sufix, o per codi postal, adreça, tarifa i consum mínim."],
            ["2", "Selecciona", "Afegeix a la cartera els subministraments que t'interessin."],
            ["3", "Analitza", "Radiografia, optimització de potència, reactiva i ofertes amb les dades oficials del SIPS."],
          ].map(([n, t, d]) => (
            <div key={n} className="flex gap-3 rounded-xl border border-border bg-surface/50 p-4">
              <div className="num grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-sm font-semibold text-accent">{n}</div>
              <div>
                <div className="text-sm font-medium">{t}</div>
                <div className="text-xs text-fg-3">{d}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-fg-3">
        <KeyRound className="size-3" /> Les credencials del portal només són al servidor. Cada consulta queda registrada i té un límit per usuari i minut.
      </p>
    </div>
  );
}
