"use client";
/**
 * A la plataforma unificada el marc (menú lateral, capçalera, cercador global, tema i avisos)
 * és el de Renewal Intelligence Pro (src/ui/components/Shell.tsx). D'aquest fitxer de cups2 només
 * es conserva la capçalera de pàgina, amb el mateix disseny original.
 */
export function PageTitle({ title, subtitle, right, icon }: { title: string; subtitle?: React.ReactNode; right?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3">
        {icon && <div className="grid size-10 place-items-center rounded-xl bg-accent/10 text-accent [&_svg]:size-5">{icon}</div>}
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-fg-3">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}
