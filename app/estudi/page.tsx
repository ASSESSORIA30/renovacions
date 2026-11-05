import type { Metadata } from "next";
import { CheckCircle2, Clock, FileSearch, Handshake, HeartHandshake, Building2, Home, MapPin, Phone, ShieldCheck, Sparkles, Upload, Zap, Flame, Globe, MessageCircle, Scale } from "lucide-react";
import { COMPANY, phoneHref, waHref } from "@/core/capture";
import { landingRef } from "@/server/capture";
import { LandingForm } from "./LandingForm";
import { UnverifiedBanner } from "@/ui/LegalShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Estudi gratuït de la teva factura de llum o gas · Assessoria 3.0",
  description: "Envia'ns la teva factura de llum o gas i t'ajudem a comprovar si pots pagar menys. Assessoria energètica a Lleida des de 2013, amb atenció personalitzada.",
  robots: { index: true, follow: true },
  openGraph: { title: "Assessoria 3.0 · Comprovem si pots pagar menys", description: "Estudi personalitzat de la teva factura de llum o gas, sense compromís.", images: ["/logo-assessoria30.png"] },
};

const FAQ: [string, string][] = [
  ["Quant costa l'estudi?", "L'estudi de la factura és gratuït i sense compromís. Si trobem una alternativa que t'interessi, t'expliquem les condicions abans de fer cap canvi."],
  ["Segur que estalviaré?", "No ho podem garantir per endavant. Comparem la teva factura amb les tarifes vigents de les comercialitzadores amb què treballem i només et proposem un canvi quan hi ha una alternativa real que et convingui. Si les teves condicions ja són bones, t'ho direm."],
  ["Quina factura he d'enviar?", "La més recent, completa (totes les pàgines). Serveix un PDF de la comercialitzadora o una foto ben enfocada feta amb el mòbil."],
  ["Quines dades llegiu de la factura?", "Les necessàries per comparar: titular, CUPS, tarifa, potències, consums per períodes, preus i imports. Una persona de l'equip revisa les dades abans de preparar cap proposta."],
  ["Em quedaré sense llum o gas en canviar?", "No. El canvi de comercialitzadora no implica cap tall de subministrament ni obres: la distribuïdora i el comptador són els mateixos."],
  ["Què feu amb les meves dades?", "Les fem servir només per estudiar la teva sol·licitud i contactar-te. Només rebràs comunicacions comercials si ho acceptes expressament. Pots exercir els teus drets en qualsevol moment."],
];

export default async function Landing({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ref = sp.ref ? await landingRef(sp.ref) : null;
  return (
    <div className="min-h-full bg-white text-zinc-900 antialiased [color-scheme:light]">
      <UnverifiedBanner />
      <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="#inici" className="flex items-center gap-2.5"><img src="/logo-assessoria30.png" alt="Assessoria 3.0" width={38} height={38} className="h-[38px] w-[38px]" /><span className="leading-tight"><span className="block text-[15px] font-bold tracking-tight">Assessoria 3.0</span><span className="block text-[11px] text-zinc-500">Assessoria energètica des de {COMPANY.since}</span></span></a>
          <nav className="hidden items-center gap-6 text-[14px] text-zinc-600 md:flex"><a href="#com-funciona" className="hover:text-emerald-700">Com funciona</a><a href="#serveis" className="hover:text-emerald-700">Serveis</a><a href="#preguntes" className="hover:text-emerald-700">Preguntes</a><a href="#contacte" className="hover:text-emerald-700">Contacte</a></nav>
          <a href={phoneHref(COMPANY.phone)} className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-[13.5px] font-semibold text-white shadow-sm hover:bg-emerald-800"><Phone size={15} /><span className="hidden sm:inline">{COMPANY.phone}</span><span className="sm:hidden">Truca&apos;ns</span></a>
        </div>
      </header>

      <main id="inici">
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(1200px_500px_at_10%_-10%,#d1fae5,transparent),radial-gradient(900px_500px_at_100%_0%,#ecfccb,transparent)]" />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-14 pt-10 sm:px-6 lg:grid-cols-[1.05fr_minmax(0,0.95fr)] lg:gap-14 lg:pb-20 lg:pt-16">
            <div className="flex flex-col justify-center">
              {ref?.valid && <p className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[12.5px] font-medium text-emerald-800"><Handshake size={14} />{ref.publicName ? `Recomanat per ${ref.publicName}` : "Codi de col·laborador aplicat"}</p>}
              <h1 className="text-[34px] font-extrabold leading-[1.08] tracking-tight sm:text-[46px]">Envia&apos;ns la teva factura de <span className="text-emerald-700">llum o gas</span> i t&apos;ajudem a comprovar si pots pagar menys.</h1>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-zinc-600">Estudiem la teva factura amb les tarifes vigents i t&apos;expliquem, amb números i sense lletra petita, si hi ha una alternativa millor. Si ja tens bones condicions, també t&apos;ho direm.</p>
              <ul className="mt-7 grid gap-3 text-[14.5px] sm:grid-cols-2">
                {[[Clock, `Experiència des de ${COMPANY.since}`], [HeartHandshake, "Atenció personalitzada"], [ShieldCheck, "Estudi gratuït i sense compromís"], [Scale, "Només et proposem canvis si hi ha una alternativa real"]].map(([I, t]) => {
                  const Icon = I as typeof Clock;
                  return <li key={t as string} className="flex items-start gap-2.5"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Icon size={14} /></span>{t as string}</li>;
                })}
              </ul>
              <div className="mt-8 flex flex-wrap items-center gap-3 text-[13px] text-zinc-500"><MapPin size={14} /> Oficina a Lleida · {COMPANY.address}</div>
            </div>
            <div id="formulari" className="scroll-mt-24"><LandingForm refCode={ref?.valid ? (sp.ref ?? "").toUpperCase() : ""} /></div>
          </div>
        </section>

        <section id="com-funciona" className="scroll-mt-20 border-t border-zinc-100 bg-zinc-50/70">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-center text-[28px] font-bold tracking-tight">Com funciona</h2>
            <p className="mx-auto mt-2 max-w-2xl text-center text-zinc-600">Tres passos, i tu decideixes al final.</p>
            <ol className="mt-10 grid gap-5 md:grid-cols-3">
              {[[Upload, "1. Ens envies la factura", "Des del mòbil o l'ordinador: un PDF o una foto de totes les pàgines."], [FileSearch, "2. L'estudiem", "Llegim les dades i les comparem amb les tarifes vigents. Una persona de l'equip revisa el resultat."], [Sparkles, "3. T'expliquem el resultat", "Et contactem amb una proposta clara: costos, condicions i validesa. Sense pressions."]].map(([I, t, d]) => {
                const Icon = I as typeof Upload;
                return <li key={t as string} className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-700 text-white"><Icon size={20} /></span><h3 className="mt-4 text-[17px] font-semibold">{t as string}</h3><p className="mt-1.5 text-[14.5px] leading-relaxed text-zinc-600">{d as string}</p></li>;
              })}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-[28px] font-bold tracking-tight">Per què Assessoria 3.0</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[[Clock, `Des de ${COMPANY.since}`, "Gestionant subministraments d'electricitat i gas per a famílies i empreses."], [HeartHandshake, "Una persona de referència", "Atenció propera, a l'oficina, per telèfon o per WhatsApp."], [Scale, "Transparència", "Et mostrem el càlcul, les hipòtesis i la validesa de cada oferta."], [Handshake, "Gestió completa", "Ens encarreguem dels tràmits del canvi o la renovació i del seguiment del contracte."]].map(([I, t, d]) => {
              const Icon = I as typeof Clock;
              return <div key={t as string} className="rounded-3xl border border-zinc-200 p-5"><Icon size={20} className="text-emerald-700" /><h3 className="mt-3 font-semibold">{t as string}</h3><p className="mt-1 text-[14px] leading-relaxed text-zinc-600">{d as string}</p></div>;
            })}
          </div>
        </section>

        <section id="serveis" className="scroll-mt-20 bg-emerald-950 text-emerald-50">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:px-6 md:grid-cols-2">
            <div className="rounded-3xl bg-white/5 p-7 ring-1 ring-white/10"><Home size={24} className="text-emerald-300" /><h3 className="mt-4 text-[21px] font-semibold text-white">Particulars</h3><ul className="mt-4 space-y-2.5 text-[15px] text-emerald-100/90">{["Estudi de la factura de llum i gas de casa", "Revisió de la potència contractada", "Canvis i renovacions sense talls de subministrament", "Seguiment abans de cada venciment"].map((x) => <li key={x} className="flex gap-2"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-300" />{x}</li>)}</ul></div>
            <div className="rounded-3xl bg-white/5 p-7 ring-1 ring-white/10"><Building2 size={24} className="text-emerald-300" /><h3 className="mt-4 text-[21px] font-semibold text-white">Empreses i autònoms</h3><ul className="mt-4 space-y-2.5 text-[15px] text-emerald-100/90">{["Tarifes 2.0TD, 3.0TD i 6.1TD i gas", "Optimització de potències amb les dades de consum", "Gestió de diversos subministraments i CUPS", "Renovacions planificades amb temps"].map((x) => <li key={x} className="flex gap-2"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-300" />{x}</li>)}</ul></div>
            <p className="flex items-center gap-2 text-[13.5px] text-emerald-200/80 md:col-span-2"><Zap size={15} /> Electricitat · <Flame size={15} /> Gas · També t&apos;informem d&apos;altres serveis si ho demanes.</p>
          </div>
        </section>

        <section id="preguntes" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16 sm:px-6">
          <h2 className="text-center text-[28px] font-bold tracking-tight">Preguntes freqüents</h2>
          <div className="mt-8 divide-y divide-zinc-200 rounded-3xl border border-zinc-200">
            {FAQ.map(([q, a]) => <details key={q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-medium">{q}<span className="text-xl leading-none text-emerald-700 transition-transform group-open:rotate-45">+</span></summary><p className="mt-2.5 text-[14.5px] leading-relaxed text-zinc-600">{a}</p></details>)}
          </div>
        </section>

        <section id="contacte" className="scroll-mt-20 border-t border-zinc-100 bg-zinc-50/70">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:px-6 md:grid-cols-3">
            <a href={phoneHref(COMPANY.phone)} className="rounded-3xl border border-zinc-200 bg-white p-6 hover:border-emerald-300"><Phone size={20} className="text-emerald-700" /><p className="mt-3 text-[13px] text-zinc-500">Telèfon</p><p className="text-[18px] font-semibold">{COMPANY.phone}</p></a>
            {COMPANY.whatsapp ? (
              <a href={waHref(COMPANY.whatsapp, "Hola! Voldria que estudiéssiu la meva factura.")} target="_blank" rel="noopener noreferrer" className="rounded-3xl border border-zinc-200 bg-white p-6 hover:border-emerald-300"><MessageCircle size={20} className="text-emerald-700" /><p className="mt-3 text-[13px] text-zinc-500">WhatsApp</p><p className="text-[18px] font-semibold">Escriu-nos</p></a>
            ) : (
              <div className="rounded-3xl border border-zinc-200 bg-white p-6"><MessageCircle size={20} className="text-emerald-700" /><p className="mt-3 text-[13px] text-zinc-500">WhatsApp</p><p className="text-[15px] font-medium">Indica-ho al formulari i et contactarem per WhatsApp.</p></div>
            )}
            <div className="rounded-3xl border border-zinc-200 bg-white p-6"><MapPin size={20} className="text-emerald-700" /><p className="mt-3 text-[13px] text-zinc-500">Oficina</p><p className="text-[16px] font-semibold">{COMPANY.address}</p><p className="mt-1 flex items-center gap-1.5 text-[13.5px] text-zinc-600"><Globe size={13} /> {COMPANY.web}</p></div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-[12.5px] text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} {COMPANY.legalName}{COMPANY.taxId ? ` · ${COMPANY.taxId}` : ""} · {COMPANY.address}</p>
          <p className="flex gap-4"><a className="hover:text-emerald-700" href="/privacitat">Privacitat</a><a className="hover:text-emerald-700" href="/avis-legal">Avís legal</a><a className="hover:text-emerald-700" href="/login">Accés professionals</a></p>
        </div>
      </footer>
      {COMPANY.whatsapp && <a href={waHref(COMPANY.whatsapp, "Hola! Voldria que estudiéssiu la meva factura.")} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" className="fixed bottom-20 right-5 z-40 grid h-14 w-14 md:bottom-5 place-items-center rounded-full bg-[#25D366] text-white shadow-lg hover:scale-105"><MessageCircle size={26} /></a>}
      <a href="#formulari" className="fixed inset-x-4 bottom-4 z-30 rounded-2xl bg-emerald-700 py-3.5 text-center text-[15px] font-semibold text-white shadow-lg md:hidden">Envia la factura</a>
    </div>
  );
}
