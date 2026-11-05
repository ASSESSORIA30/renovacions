"use client";
import * as React from "react";
import * as SliderP from "@radix-ui/react-slider";
import * as TabsP from "@radix-ui/react-tabs";
import * as TooltipP from "@radix-ui/react-tooltip";
import * as DialogP from "@radix-ui/react-dialog";
import * as SwitchP from "@radix-ui/react-switch";
import * as CollP from "@radix-ui/react-collapsible";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertOctagon, AlertTriangle, ChevronDown, Info, X, CircleAlert, CircleCheck, FlaskConical } from "lucide-react";
import { cn } from "@/energy/lib/format";
import type { Severity } from "@/energy/lib/alerts";

/* Button */
const buttonV = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:brightness-110 shadow-[0_0_0_1px_rgb(var(--accent)),0_8px_24px_-8px_rgb(var(--accent))]",
        secondary: "bg-surface-2 text-fg hover:bg-border border border-border",
        outline: "border border-border-strong bg-transparent hover:bg-surface-2",
        ghost: "hover:bg-surface-2 text-fg-2 hover:text-fg",
        danger: "bg-critical/10 text-critical hover:bg-critical/20 border border-critical/30",
      },
      size: { sm: "h-8 px-3 text-xs", md: "h-9 px-4", lg: "h-11 px-6 text-base", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);
export function Button({ className, variant, size, asChild, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonV> & { asChild?: boolean }) {
  const C = asChild ? Slot : "button";
  return <C className={cn(buttonV({ variant, size }), className)} {...p} />;
}

/* Card */
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-surface/80 backdrop-blur-sm shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]", className)} {...p} />;
}
export function CardHeader({ title, subtitle, icon, right, className }: { title: React.ReactNode; subtitle?: React.ReactNode; icon?: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-5", className)}>
      <div className="flex items-start gap-3 min-w-0">
        {icon && <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent [&_svg]:size-4">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-fg">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-fg-3">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...p} />;
}

/* Badge */
const badgeV = cva("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "border-border bg-surface-2 text-fg-2",
      accent: "border-accent/30 bg-accent/10 text-accent",
      blue: "border-accent-2/30 bg-accent-2/10 text-accent-2",
      good: "border-good/30 bg-good/10 text-good",
      warning: "border-warning/40 bg-warning/10 text-[color-mix(in_srgb,rgb(var(--warning))_75%,rgb(var(--fg)))]",
      serious: "border-serious/40 bg-serious/10 text-serious",
      critical: "border-critical/40 bg-critical/10 text-critical",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export function Badge({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeV>) {
  return <span className={cn(badgeV({ tone }), className)} {...p} />;
}

export function SeverityBadge({ s }: { s: Severity }) {
  const map = {
    critica: { tone: "critical", icon: <AlertOctagon />, label: "Crítica" },
    alta: { tone: "serious", icon: <AlertTriangle />, label: "Alta" },
    media: { tone: "warning", icon: <CircleAlert />, label: "Media" },
    baja: { tone: "neutral", icon: <Info />, label: "Baja" },
    info: { tone: "blue", icon: <Info />, label: "Info" },
  } as const;
  const m = map[s];
  return (
    <Badge tone={m.tone}>
      {m.icon}
      {m.label}
    </Badge>
  );
}

export function DemoBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <Badge tone="warning" title="Datos sintéticos generados para demostración y pruebas">
      <FlaskConical /> DEMO
    </Badge>
  );
}

export function QualityBadge({ q }: { q: "exacto" | "orientativo" | "rango" | "preliminar" | "medido" | "cota" }) {
  const m = {
    exacto: ["good", "Exacto"],
    medido: ["good", "Medido"],
    orientativo: ["warning", "Orientativo"],
    preliminar: ["warning", "Preliminar"],
    rango: ["blue", "Rango garantizado"],
    cota: ["blue", "Cota superior"],
  } as const;
  const [tone, label] = m[q];
  return (
    <Badge tone={tone}>
      {q === "exacto" || q === "medido" ? <CircleCheck /> : <Info />}
      {label}
    </Badge>
  );
}

/* Inputs */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-lg border border-border bg-bg-elev px-3 text-sm text-fg placeholder:text-fg-3 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60 transition",
        className,
      )}
      {...p}
    />
  );
});
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("w-full rounded-lg border border-border bg-bg-elev px-3 py-2 text-sm text-fg placeholder:text-fg-3 focus:outline-none focus:ring-2 focus:ring-accent/40", className)} {...p} />;
}
export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-9 rounded-lg border border-border bg-bg-elev px-2.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent/40", className)} {...p} />;
}
export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-xs font-medium text-fg-2", className)} {...p} />;
}
export function Field({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-fg-3">{hint}</p>}
    </div>
  );
}
export function NumInput({ value, onChange, step = 0.01, className, ...p }: { value: number | null; onChange: (v: number | null) => void; step?: number; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <Input
      inputMode="decimal"
      step={step}
      value={draft ?? (value == null ? "" : String(value))}
      className={cn("num", className)}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value);
        const t = e.target.value.replace(",", ".").trim();
        if (t === "") onChange(null);
        else if (!isNaN(Number(t))) onChange(Number(t));
      }}
      {...p}
    />
  );
}

/* Slider */
export function Slider({ className, ...p }: React.ComponentProps<typeof SliderP.Root>) {
  return (
    <SliderP.Root className={cn("relative flex h-5 w-full touch-none select-none items-center", className)} {...p}>
      <SliderP.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-2 border border-border">
        <SliderP.Range className="absolute h-full bg-gradient-to-r from-accent-2 to-accent" />
      </SliderP.Track>
      <SliderP.Thumb className="block size-4 rounded-full border-2 border-accent bg-bg shadow-[0_0_0_4px_var(--glow)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="valor" />
    </SliderP.Root>
  );
}

/* Tabs */
export const Tabs = TabsP.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof TabsP.List>) {
  return <TabsP.List className={cn("flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface/70 p-1 backdrop-blur", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof TabsP.Trigger>) {
  return (
    <TabsP.Trigger
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-fg-3 transition hover:text-fg data-[state=active]:bg-surface-2 data-[state=active]:text-fg data-[state=active]:shadow-[inset_0_0_0_1px_rgb(var(--border-strong))] [&_svg]:size-4",
        className,
      )}
      {...p}
    />
  );
}
export const TabsContent = TabsP.Content;

/* Tooltip */
export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipP.Provider delayDuration={150}>
      <TooltipP.Root>
        <TooltipP.Trigger asChild>{children}</TooltipP.Trigger>
        <TooltipP.Portal>
          <TooltipP.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-lg border border-border-strong bg-bg-elev px-3 py-2 text-xs leading-relaxed text-fg-2 shadow-xl">
            {content}
          </TooltipP.Content>
        </TooltipP.Portal>
      </TooltipP.Root>
    </TooltipP.Provider>
  );
}
export function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <Tip content={children}>
      <button type="button" className="inline-grid size-4 place-items-center rounded-full text-fg-3 hover:text-accent" aria-label="Más información">
        <Info className="size-3.5" />
      </button>
    </Tip>
  );
}

/* Dialog */
export function Dialog({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <DialogP.Root open={open} onOpenChange={onOpenChange}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <DialogP.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border-strong bg-bg-elev p-6 shadow-2xl", wide ? "max-w-4xl" : "max-w-lg")}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <DialogP.Title className="text-base font-semibold">{title}</DialogP.Title>
              {description && <DialogP.Description className="mt-1 text-xs text-fg-3">{description}</DialogP.Description>}
            </div>
            <DialogP.Close className="rounded-md p-1 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="Cerrar">
              <X className="size-4" />
            </DialogP.Close>
          </div>
          {children}
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}

/* Switch */
export function Switch(p: React.ComponentProps<typeof SwitchP.Root>) {
  return (
    <SwitchP.Root className="relative h-5 w-9 shrink-0 rounded-full border border-border-strong bg-surface-2 transition data-[state=checked]:bg-accent" {...p}>
      <SwitchP.Thumb className="block size-4 translate-x-0.5 rounded-full bg-fg shadow transition data-[state=checked]:translate-x-[17px] data-[state=checked]:bg-accent-fg" />
    </SwitchP.Root>
  );
}

/* Collapsible */
export function Collapse({ title, children, defaultOpen = false, right }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <CollP.Root open={open} onOpenChange={setOpen} className="rounded-xl border border-border bg-surface/60">
      <CollP.Trigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium hover:bg-surface-2/60 rounded-xl">
        <span className="flex items-center gap-2">{title}</span>
        <span className="flex items-center gap-2">
          {right}
          <ChevronDown className={cn("size-4 text-fg-3 transition", open && "rotate-180")} />
        </span>
      </CollP.Trigger>
      <CollP.Content className="px-4 pb-4">{children}</CollP.Content>
    </CollP.Root>
  );
}

/* KPI */
export function Kpi({ label, value, unit, sub, icon, accent, hint, className }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; icon?: React.ReactNode; accent?: boolean; hint?: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("relative overflow-hidden p-5", accent && "border-accent/30", className)}>
      {accent && <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-accent/10 blur-3xl" />}
      <div className="flex items-center justify-between text-xs text-fg-3">
        <span className="flex items-center gap-1.5">
          {label}
          {hint && <InfoTip>{hint}</InfoTip>}
        </span>
        {icon && <span className="text-fg-3 [&_svg]:size-4">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={cn("num text-2xl font-semibold tracking-tight", accent && "text-grad")}>{value}</span>
        {unit && <span className="text-sm text-fg-3">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-fg-3">{sub}</div>}
    </Card>
  );
}

export function Empty({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border-strong p-10 text-center">
      {icon && <div className="grid size-12 place-items-center rounded-2xl bg-accent/10 text-accent [&_svg]:size-6">{icon}</div>}
      <h3 className="text-sm font-semibold">{title}</h3>
      {children && <div className="max-w-md text-sm text-fg-3">{children}</div>}
    </div>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warning" | "critical" | "good"; title?: React.ReactNode; children: React.ReactNode }) {
  const t = {
    info: "border-accent-2/30 bg-accent-2/5",
    warning: "border-warning/40 bg-warning/5",
    critical: "border-critical/40 bg-critical/5",
    good: "border-good/30 bg-good/5",
  }[tone];
  const I = tone === "critical" ? AlertOctagon : tone === "warning" ? AlertTriangle : tone === "good" ? CircleCheck : Info;
  const ic = { info: "text-accent-2", warning: "text-warning", critical: "text-critical", good: "text-good" }[tone];
  return (
    <div className={cn("flex gap-3 rounded-xl border p-3.5 text-sm", t)}>
      <I className={cn("mt-0.5 size-4 shrink-0", ic)} />
      <div className="min-w-0 text-fg-2 [&_b]:text-fg">
        {title && <div className="mb-0.5 font-medium text-fg">{title}</div>}
        {children}
      </div>
    </div>
  );
}
