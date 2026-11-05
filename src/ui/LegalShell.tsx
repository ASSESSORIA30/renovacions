/** Contenidor de les pàgines públiques legals (servidor). */
import { COMPANY } from "@/core/capture";

export function UnverifiedBanner() {
  if (COMPANY.verified) return null;
  return <div className="bg-amber-100 px-4 py-1.5 text-center text-[12px] text-amber-900">Dades corporatives i textos legals pendents de verificació per Direcció abans de publicar (NEXT_PUBLIC_COMPANY_VERIFIED).</div>;
}

export function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-white text-zinc-900 [color-scheme:light]">
      <UnverifiedBanner />
      <header className="border-b border-zinc-200"><div className="mx-auto flex h-16 max-w-3xl items-center gap-2.5 px-4"><a href="/estudi" className="flex items-center gap-2.5"><img src="/logo-assessoria30.png" alt="Assessoria 3.0" width={34} height={34} /><span className="font-bold">Assessoria 3.0</span></a></div></header>
      <main className="mx-auto max-w-3xl px-4 py-10 text-[15px] leading-relaxed text-zinc-700 [&_h2]:mt-8 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:text-zinc-900 [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-5">
        <h1 className="text-[28px] font-bold tracking-tight text-zinc-900">{title}</h1>
        {children}
      </main>
    </div>
  );
}
