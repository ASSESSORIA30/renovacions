import type { Metadata } from "next";
import { publicProposal } from "@/server/comparisons";
import { presentationOrder } from "@/comparator/snapshot";
import { CONTRACT_TYPE_LABEL, SAS_LABEL } from "@/comparator/types";
import { InterestForm } from "./InterestForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Proposta energètica · Assessoria 3.0", robots: { index: false, follow: false } };

const eur = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));

/** Portal privat: només lectura, enllaç amb caducitat i revocable. No mostra dades internes ni comissions. */
export default async function ProposalPortal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = await publicProposal(token).catch(() => null);
  if (!p)
    return (
      <main className="flex min-h-full items-center justify-center bg-bg p-6 text-center">
        <div className="max-w-sm rounded-2xl border border-line bg-surface p-6">
          <h1 className="text-lg font-semibold">Enllaç no disponible</h1>
          <p className="mt-2 text-sm text-muted">L&apos;enllaç ha caducat o s&apos;ha revocat. Contacta amb el teu assessor d&apos;Assessoria 3.0.</p>
        </div>
      </main>
    );
  const s = p.comparison.snapshot;
  const alts = presentationOrder(s);
  const reco = p.comparison.recommendation?.edited?.text ?? p.comparison.recommendation?.ai?.sections?.principal ?? null;
  return (
    <main className="min-h-full bg-bg px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/logo-assessoria30.png" alt="Assessoria 3.0" className="h-12 w-12 rounded-full" />
            <div>
              <h1 className="text-xl font-semibold">Proposta energètica{p.comparison.client_name ? ` · ${p.comparison.client_name}` : ""}</h1>
              <p className="text-sm text-muted">Preparada per {p.comparison.created_by_name ?? "Assessoria 3.0"} · enllaç vàlid fins al {new Date(p.expiresAt).toLocaleDateString("ca-ES")}</p>
            </div>
          </div>
          <span className="rounded-full bg-elevated px-3 py-1 text-xs text-muted">{s.supply.accessTariff ?? ""} · {s.cups ?? ""}</span>
        </header>
        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">Contracte actual{s.currentRetailer ? ` · ${s.currentRetailer}` : ""}</p>
            <p className="mt-2 text-2xl font-semibold tnum">{s.result.current?.ok ? eur(s.result.current.total) : "—"}</p>
            <p className="text-xs text-muted">{s.result.current?.ok ? "Cost anual amb impostos" : "Sense preus actuals"}</p>
          </div>
          {alts.map((e, i) => (
            <div key={e.offer.id} className={`rounded-2xl border bg-surface p-4 ${i === 0 ? "border-brand ring-2 ring-brand/20" : "border-line"}`}>
              <p className="text-xs text-muted">{i === 0 ? "Recomanada" : `Alternativa ${i + 1}`}</p>
              <p className="mt-1 font-semibold">{e.offer.supplierName}</p>
              <p className="text-xs text-muted">{e.offer.productName} · {CONTRACT_TYPE_LABEL[e.offer.contractType]}</p>
              <p className="mt-2 text-2xl font-semibold tnum">{e.cost.ok ? eur(e.cost.total) : "No calculable"}</p>
              {e.saving != null && <p className={`text-sm font-medium ${e.saving >= 0 ? "text-ren" : "text-lost"}`}>{e.saving >= 0 ? "Estalvi" : "Més car"} {eur(Math.abs(e.saving))} ({Math.abs(e.savingPct ?? 0).toLocaleString("ca-ES", { maximumFractionDigits: 1 })} %)</p>}
              <ul className="mt-2 space-y-0.5 text-xs text-muted">
                <li>{SAS_LABEL[e.offer.sas.mode]}</li>
                <li>{e.offer.permanenceMonths ? `Permanència ${e.offer.permanenceMonths} mesos` : "Sense permanència"}</li>
                {e.offer.validTo && <li>Oferta vàlida fins al {new Date(e.offer.validTo).toLocaleDateString("ca-ES")}</li>}
                {e.cost.quality !== "exacte" && <li className="text-pend">Import {e.cost.quality === "estimat" ? "estimat" : "incomplet"}</li>}
              </ul>
            </div>
          ))}
        </section>
        {reco && (
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-semibold">Recomanació</h2>
            <p className="mt-2 whitespace-pre-line text-sm">{reco}</p>
          </section>
        )}
        <InterestForm token={token} offers={alts.map((e) => ({ id: e.offer.id, label: `${e.offer.supplierName} · ${e.offer.productName}` }))} />
        <p className="text-center text-[11px] text-muted">Imports amb impostos calculats amb les dades i hipòtesis de la proposta. No constitueix una acceptació contractual: la contractació requereix identificació i consentiment.</p>
      </div>
    </main>
  );
}
