"use client";
import { DropArea } from "@/ui/components/DropZone";
import { Image as ImageIcon, KeyRound, RotateCcw, Scale, Settings, Trash2 } from "lucide-react";
import { toast } from "@/energy/compat/toast";
import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, useStore } from "@/energy/lib/store";
import { energyApi, serverEnabled, type SipsStatus } from "@/energy/api";
import { TARIFFS, powerPeriods, regulatedPowerPrice } from "@/energy/lib/tariffs";
import { DEFAULT_SCORING, type ScoringConfig } from "@/energy/lib/scoring";
import { DEFAULT_ALERT_CONFIG, type AlertConfig } from "@/energy/lib/alerts";
import { fmt } from "@/energy/lib/format";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Field, Input, NumInput } from "@/energy/components/ui";
import { PageTitle } from "@/energy/components/shell";

export function EnergySettingsView() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const clear = useStore((s) => s.clearSupplies);
  const reg = settings.regulated;
  const [sips, setSips] = useState<SipsStatus | null>(null);
  useEffect(() => {
    if (serverEnabled()) energyApi.status().then(setSips).catch(() => setSips(null));
  }, []);

  const setPeaje = (t: (typeof TARIFFS)[number], i: number, v: number | null, key: "peajePot" | "cargoPot" | "excess45") =>
    setSettings((s) => ({ ...s, regulated: { ...s.regulated, [key]: { ...s.regulated[key], [t]: s.regulated[key][t].map((x, j) => (j === i ? (v ?? 0) : x)) } } }));

  return (
    <div className="space-y-5">
      <PageTitle icon={<Settings />} title="Configuració energètica" subtitle="Paràmetres normatius, puntuació, alertes i informes del mòdul d'intel·ligència energètica" />

      <Card>
        <CardHeader icon={<Scale />} title="Tarifa regulada configurada" subtitle={`${reg.label} · vigente ${fmt.date(reg.validFrom)} – ${fmt.date(reg.validTo)}`} right={<Button variant="ghost" size="sm" onClick={() => setSettings((s) => ({ ...s, regulated: DEFAULT_SETTINGS.regulated }))}><RotateCcw /> Valores BOE 2026</Button>} />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2 text-[11px]">
            {reg.sources.map((s) => (
              <a key={s.ref} href={s.url} target="_blank" rel="noreferrer" className="rounded-md border border-border px-2 py-1 text-fg-2 hover:text-accent">
                {s.label}: {s.ref}
              </a>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Etiqueta">
              <Input value={reg.label} onChange={(e) => setSettings((s) => ({ ...s, regulated: { ...s.regulated, label: e.target.value } }))} />
            </Field>
            <Field label="Vigente desde">
              <Input type="date" value={reg.validFrom} onChange={(e) => setSettings((s) => ({ ...s, regulated: { ...s.regulated, validFrom: e.target.value } }))} />
            </Field>
            <Field label="Vigente hasta">
              <Input type="date" value={reg.validTo} onChange={(e) => setSettings((s) => ({ ...s, regulated: { ...s.regulated, validTo: e.target.value } }))} />
            </Field>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="text-fg-3">
                <tr>
                  <th className="p-1 text-left">Peaje</th>
                  <th className="p-1 text-left">Concepto</th>
                  {[1, 2, 3, 4, 5, 6].map((p) => (
                    <th key={p} className="p-1">
                      P{p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TARIFFS.map((t) =>
                  (
                    [
                      ["peajePot", "Peaje T&D €/kW·año"],
                      ["cargoPot", "Cargos €/kW·año"],
                      ["excess45", "Exceso tipo 4-5 €/kW·día"],
                    ] as const
                  ).map(([k, l], li) => (
                    <tr key={`${t}${k}`} className={li === 0 ? "border-t border-border" : ""}>
                      <td className="p-1 font-medium">{li === 0 ? t : ""}</td>
                      <td className="p-1 text-fg-3">{l}</td>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <td key={i} className="p-1">
                          {i < powerPeriods(t) ? <NumInput className="h-7 text-xs" value={reg[k][t][i]} onChange={(v) => setPeaje(t, i, v, k)} /> : null}
                        </td>
                      ))}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-fg-3">ATR resultante 3.0TD: {regulatedPowerPrice(reg, "3.0TD").map((v) => fmt.n(v, 6)).join(" · ")} €/kW·año.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Margen comercial por defecto (€/kW·año)">
              <NumInput value={settings.marginPowerEurKWyr} onChange={(v) => setSettings((s) => ({ ...s, marginPowerEurKWyr: v ?? 0 }))} />
            </Field>
            <Field label="Derechos de extensión (€/kW)" hint="RD 1048/2013, BT">
              <NumInput value={settings.modCosts.extensionEurKW} onChange={(v) => setSettings((s) => ({ ...s, modCosts: { ...s.modCosts, extensionEurKW: v ?? 0 } }))} />
            </Field>
            <Field label="Derechos de acceso (€/kW)" hint="RD 1048/2013, BT">
              <NumInput value={settings.modCosts.accesoEurKW} onChange={(v) => setSettings((s) => ({ ...s, modCosts: { ...s.modCosts, accesoEurKW: v ?? 0 } }))} />
            </Field>
            <Field label="Coste fijo por modificación (€)" hint="Enganche u otros cargos de gestión">
              <NumInput value={settings.modCosts.fixedEur} onChange={(v) => setSettings((s) => ({ ...s, modCosts: { ...s.modCosts, fixedEur: v ?? 0 } }))} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {reg.reactive.map((r, i) => (
              <Field key={i} label={`Reactiva cos φ ≥ ${r.cosFrom} (€/kVArh)`}>
                <NumInput value={r.price} onChange={(v) => setSettings((s) => ({ ...s, regulated: { ...s.regulated, reactive: s.regulated.reactive.map((x, j) => (j === i ? { ...x, price: v ?? 0 } : x)) } }))} />
              </Field>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Puntuación comercial" subtitle="Pesos de cada criterio (se normaliza a 0–100)" right={<Button variant="ghost" size="sm" onClick={() => setSettings((s) => ({ ...s, scoring: DEFAULT_SCORING }))}><RotateCcw /> Restablecer</Button>} />
          <CardBody className="grid grid-cols-2 gap-3">
            {(
              [
                ["consumoUmbralKWh", "Umbral de consumo (kWh)"],
                ["wConsumo", "Peso consumo"],
                ["wTarifa", "Peso tarifa 3.0/6.x"],
                ["wReactiva", "Peso reactiva"],
                ["wSobredim", "Peso margen de potencia"],
                ["wPermanencia", "Peso tiempo con comercializadora"],
                ["wAutoconsumo", "Peso autoconsumo potencial"],
                ["penalNoContratable", "Penalización no contratable"],
                ["penalImpagos", "Penalización impagos"],
              ] as [keyof ScoringConfig, string][]
            ).map(([k, l]) => (
              <Field key={k} label={l}>
                <NumInput value={settings.scoring[k]} onChange={(v) => setSettings((s) => ({ ...s, scoring: { ...s.scoring, [k]: v ?? 0 } }))} />
              </Field>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Reglas de alertas" right={<Button variant="ghost" size="sm" onClick={() => setSettings((s) => ({ ...s, alerts: DEFAULT_ALERT_CONFIG }))}><RotateCcw /> Restablecer</Button>} />
          <CardBody className="grid grid-cols-2 gap-3">
            {(
              [
                ["expiryWarnDays", "Aviso caducidad BIE/APM (días)"],
                ["readingStaleDays", "Lectura antigua (días)"],
                ["readingVeryStaleDays", "Lectura muy antigua (días)"],
                ["rightsWarnDays", "Aviso derechos reconocidos (días)"],
                ["oversizeUtilPct", "Sobredimensionamiento si utilización < (%)"],
              ] as [keyof AlertConfig, string][]
            ).map(([k, l]) => (
              <Field key={k} label={l}>
                <NumInput value={settings.alerts[k]} onChange={(v) => setSettings((s) => ({ ...s, alerts: { ...s.alerts, [k]: v ?? 0 } }))} />
              </Field>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<ImageIcon />} title="Identidad de los informes" />
          <CardBody className="space-y-3">
            <Field label="Nombre del comercial (firma de informes y CRM)">
              <Input value={settings.userName} onChange={(e) => setSettings((s) => ({ ...s, userName: e.target.value }))} />
            </Field>
            <Field label="Logo de Assessoria 3.0 para PDF (PNG/JPG)" hint="Opcional. Por defecto todos los informes llevan el logo oficial de Assessoria 3.0. También puedes arrastrar la imagen.">
              <DropArea accept="image/png,image/jpeg,.png,.jpg,.jpeg" label="Logo" onFiles={([f]) => { const r = new FileReader(); r.onload = () => { setSettings((s) => ({ ...s, logoDataUrl: String(r.result) })); toast.success("Logo guardado"); }; r.readAsDataURL(f); }}>
              <Input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const r = new FileReader();
                  r.onload = () => {
                    setSettings((s) => ({ ...s, logoDataUrl: String(r.result) }));
                    toast.success("Logo guardado");
                  };
                  r.readAsDataURL(f);
                }}
              />
              </DropArea>
            </Field>
            {settings.logoDataUrl && (
              <div className="flex items-center gap-3">
                { }
                <img src={settings.logoDataUrl} alt="Logo" className="h-10 rounded bg-white p-1" />
                <Button size="sm" variant="ghost" onClick={() => setSettings((s) => ({ ...s, logoDataUrl: null }))}>
                  Quitar
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
        <SipsServerCard sips={sips} />
      </div>
      <Card>
        <CardHeader icon={<Trash2 />} title="Datos locales" subtitle="La cartera, ofertas y CRM se guardan en este navegador (IndexedDB)." />
        <CardBody>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm("¿Eliminar todos los suministros importados de este navegador?")) {
                clear();
                toast("Cartera eliminada");
              }
            }}
          >
            Eliminar suministros importados
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

function SipsServerCard({ sips }: { sips: SipsStatus | null }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader
        icon={<KeyRound />}
        title="Buscador i sincronització SIPS"
        subtitle="Portal EAS Renovae · credencials només al servidor"
        right={<Badge tone={sips?.configured ? "good" : "warning"}>{!serverEnabled() ? "Mode local" : !sips ? "Comprovant…" : sips.configured ? "Servidor configurat" : "Falta configurar"}</Badge>}
      />
      <CardBody className="space-y-3 text-sm text-fg-2">
        <p>
          Les consultes es fan amb la sessió de la plataforma (Supabase): no cal cap clau d&apos;accés al navegador. Dades vigents durant <b>{sips?.ttlDays ?? 7} dies</b>; després s&apos;actualitzen automàticament (cron diari) o des de la fitxa.
        </p>
        {sips && !sips.configured && (
          <Callout tone="warning" title="Configuració a Vercel">
            Defineix <code>SIPS_USER</code> i <code>SIPS_PASSWORD</code> (Production i Preview) i torna a desplegar. Opcionals: <code>SIPS_TTL_DAYS</code>, <code>SIPS_CRON_LIMIT</code>, <code>SIPS_EXTERNAL_ROLES</code>.
          </Callout>
        )}
        {sips?.staff && sips.configured && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setRes(null);
                try {
                  const r = await energyApi.enrich();
                  setRes(`${r.updated} actualitzats · ${r.failed} amb error · ${r.pending} pendents (de ${r.due} caducats; ${r.candidates} CUPS de llum pendents/contactats)`);
                } catch (e) {
                  setRes(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Actualitzant…" : "Enriqueix ara els contractes pendents"}
            </Button>
            {res && <span className="text-xs text-fg-3">{res}</span>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
