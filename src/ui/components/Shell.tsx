"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronsLeft, ChevronsRight, FileSpreadsheet, FileStack, Menu, Moon, RefreshCw, Search, Star, Sun, Users, X, Zap, WandSparkles } from "lucide-react";
import { daysUntil, fmtDateTime, relDays } from "@/core/dates";
import { expiry } from "@/core/insights";
import { titleCase } from "@/core/templates";
import { NAV_MAIN_ID, useApp, type View } from "@/data/store";
import { BackButton, Breadcrumbs, RecentMenu, useBackShortcut } from "./Navigation";
import { UserMenu } from "../account";
import { EASE_OUT, SupplierMark, cn } from "./ui";
import { STATUS_META, matchesSearch } from "../selectors";
import { LOGO_DATA_URL } from "@/core/logo";
import { AmbientLayer, ThemeChip, ThemeRibbon } from "./Ambient";
import { ROLE_LABEL } from "@/core/roles";
import { useCan, useSession } from "../session";
import { supabaseConfigured } from "@/data/browserSupabase";
import { NotificationsBell } from "./NotificationsBell";
import { CopilotButton } from "./Copilot";
import { NAV, NAV_GROUPS, activeKey, filterGroups, visibleItem, type NavItem } from "./nav";
import { useNavPrefs } from "../navPrefs";

const TITLES: Partial<Record<View, string>> = { control: "Centre de Control", "panell-cap": "Supervisió administrativa", "jornada-admin": "La meva jornada", "panell-comercial": "Panell comercial", tasques: "Tasques", incidencies: "Incidències", informes: "Informes i productivitat", qualitat: "Qualitat de dades", "centre-alertes": "Alertes i automatitzacions", permisos: "Usuaris i permisos", fitxa: "Fitxa energètica", ajustes: "Configuració", client: "Fitxa de client", oportunitat: "Fitxa d'oportunitat", expedient: "Expedient de contractació", liquidacio: "Liquidació", economia: "Control econòmic", regles: "Regles de comissions", conciliacio: "Conciliació", reclamacions: "Reclamacions a comercialitzadores", liquidacions: "Liquidacions", ia: "Intel·ligència IA", "ia-oportunitat": "Oportunitat detectada", captacio: "Captació i col·laboradors", "captacio-lead": "Lead captat", perfil: "El meu perfil", agenda: "Agenda" };

/** Esdeveniments globals per a les opcions del menú que són accions (no pantalles). */
export const NAV_EVENT = { search: "a30:focus-search", copilot: "a30:open-copilot" } as const;

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src={LOGO_DATA_URL} alt="Assessoria 3.0" width={34} height={34} className="h-[34px] w-[34px] shrink-0" />
      {!compact && (
        <div className="leading-none">
          <div className="text-[14px] font-bold tracking-tight">Assessoria 3.0</div>
          <div className="mt-0.5 text-[10.5px] text-muted">Intelligence Platform</div>
        </div>
      )}
    </div>
  );
}

/** Comptadors del menú: tasques vençudes assignades a l'usuari (dada real del servidor; sense Supabase, cap). */
function useBadges(enabled: boolean) {
  const [tasks, setTasks] = useState(0);
  useEffect(() => {
    if (!enabled || !supabaseConfigured) return;
    let alive = true;
    const load = () => fetch("/api/work?r=tasks&scope=meves&status=vencudes", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j) setTasks(j.total ?? 0); }).catch(() => undefined);
    void load();
    const t = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, [enabled]);
  return { tasks };
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { view, set, dark, snap, repo, params, navigate } = useApp();
  const [mobileNav, setMobileNav] = useState(false);
  useBackShortcut();
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("rip:theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);
  const role = snap?.me.role;
  const loadSession = useSession((s) => s.load);
  useEffect(() => { if (role) void loadSession(role); }, [role, loadSession]);
  const canDo = useCan();
  const prefs = useNavPrefs();
  useEffect(() => { void prefs.load(); }, [prefs]);
  const visible = (n: NavItem) => visibleItem(n, role, canDo);
  const allVisible = NAV.filter(visible);
  const current = activeKey(allVisible, view, params);
  const badges = useBadges(allVisible.some((n) => n.badge === "tasks"));
  const [q, setQ] = useState("");
  const mini = prefs.mini && !mobileNav;

  const go = (n: NavItem) => {
    setMobileNav(false);
    if (n.run) { window.dispatchEvent(new Event(NAV_EVENT[n.run])); return; }
    // Entrar a Renovacions des del menú mostra sempre el Kanban complet (es treu el filtre de xifra del Dashboard)
    if (n.id === "kanban" && useApp.getState().filter.kpi) set("filter", { ...useApp.getState().filter, kpi: null });
    navigate(n.id, n.params ?? {});
    setQ("");
  };
  const toggleFav = (k: string) => prefs.update({ fav: prefs.fav.includes(k) ? prefs.fav.filter((x) => x !== k) : [...prefs.fav, k] });
  const toggleGroup = (t: string) => prefs.update({ closed: { ...prefs.closed, [t]: !prefs.closed[t] } });

  // Navegació amb teclat: fletxes amunt/avall entre opcions, Inici/Fi
  const navRef = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const els = Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>("[data-nav]") ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const n = e.key === "Home" ? 0 : e.key === "End" ? els.length - 1 : Math.min(els.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
    els[n]?.focus();
  };

  const groups = useMemo(() => {
    const base = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length);
    const favs = prefs.fav.map((k) => allVisible.find((n) => n.key === k)).filter((n): n is NavItem => !!n);
    return filterGroups(favs.length ? [{ title: "Preferits", items: favs }, ...base] : base, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, canDo, prefs.fav, q]);

  const item = (n: NavItem, g: { title: string; tone?: string }) => {
    const active = n.key === current;
    const fav = prefs.fav.includes(n.key);
    const badge = n.badge === "tasks" && badges.tasks > 0 ? badges.tasks : 0;
    return (
      <div key={`${g.title}-${n.key}`} className="group/item relative">
        <button data-nav onClick={() => go(n)} aria-current={active ? "page" : undefined} title={mini ? n.label : undefined} aria-label={mini ? n.label : undefined}
          className={cn("relative flex w-full items-center gap-2.5 rounded-lg py-[7px] text-left text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/60", mini ? "justify-center px-0" : "px-2.5 pr-7", active ? "text-ink" : "text-muted hover:bg-ink/[0.04] hover:text-ink")}>
          {active && g.title !== "Preferits" && <motion.span layoutId="nav-active" className={cn("absolute inset-0 rounded-lg", g.tone === "energy" ? "bg-accent/10" : "bg-ink/[0.07]")} transition={{ duration: 0.22, ease: EASE_OUT }} />}
          {active && <span aria-hidden className={cn("absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full", g.tone === "energy" ? "bg-accent" : "bg-brand")} />}
          <n.icon size={16} className={cn("relative shrink-0", active && (g.tone === "energy" ? "text-accent" : "text-brand"))} />
          {!mini && <span className="relative min-w-0 flex-1 truncate">{n.label}</span>}
          {badge > 0 && <span className={cn("relative grid h-[18px] min-w-[18px] place-items-center rounded-full bg-lost px-1 text-[10px] font-bold text-white tnum", mini && "absolute -right-0.5 -top-0.5 h-4 min-w-4")} aria-label={`${badge} vençudes`}>{badge > 99 ? "99+" : badge}</span>}
        </button>
        {!mini && (
          <button onClick={() => toggleFav(n.key)} aria-label={fav ? `Treu ${n.label} dels preferits` : `Afegeix ${n.label} als preferits`} aria-pressed={fav}
            className={cn("absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 transition-opacity focus-visible:opacity-100", fav ? "text-amber-500 opacity-100" : "text-muted opacity-0 hover:text-ink group-hover/item:opacity-100", badge > 0 && !fav && "hidden")}>
            <Star size={12} fill={fav ? "currentColor" : "none"} />
          </button>
        )}
      </div>
    );
  };

  const sidebar = (
    <nav aria-label="Menú principal" className="flex h-full flex-col gap-1 p-3">
      <div className={cn("flex items-center pb-3 pt-1", mini ? "justify-center" : "justify-between px-2")}>
        <Logo compact={mini} />
        {!mobileNav && !mini && <button onClick={() => prefs.update({ mini: true })} aria-label="Plega el menú" title="Plega el menú" className="pressable rounded-md p-1 text-muted hover:bg-ink/5 hover:text-ink"><ChevronsLeft size={16} /></button>}
      </div>
      {mini ? (
        <button onClick={() => prefs.update({ mini: false })} aria-label="Desplega el menú" title="Desplega el menú" className="pressable mx-auto mb-2 rounded-md p-1.5 text-muted hover:bg-ink/5 hover:text-ink"><ChevronsRight size={16} /></button>
      ) : (
        <div className="relative mb-2 px-0.5">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); if (e.key === "ArrowDown") { e.preventDefault(); navRef.current?.querySelector<HTMLButtonElement>("[data-nav]")?.focus(); } if (e.key === "Enter") { const first = groups[0]?.items[0]; if (first) go(first); } }}
            placeholder="Cerca al menú…" aria-label="Cerca al menú" className="input h-8 pl-8 text-[12.5px]" />
        </div>
      )}
      <div ref={navRef} onKeyDown={onKey} className="scroll-thin -mx-1 flex-1 space-y-3 overflow-y-auto px-1">
        {groups.map((g) => {
          const closed = !q && !!prefs.closed[g.title] && !g.items.some((n) => n.key === current);
          return (
            <div key={g.title} role="group" aria-label={g.title}>
              {mini ? <div className="mx-auto mb-1 h-px w-6 bg-line" aria-hidden /> : (
                <button onClick={() => toggleGroup(g.title)} aria-expanded={!closed} className={cn("mb-1 flex w-full items-center gap-1.5 rounded px-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/60", g.tone === "energy" ? "text-accent" : "text-muted/80")}>
                  {g.title === "Preferits" && <Star size={11} className="text-amber-500" />}{g.tone === "energy" && <Zap size={11} />}{g.tone === "ai" && <WandSparkles size={11} className="text-brand" />}<span className="flex-1">{g.title}</span><ChevronDown size={12} className={cn("transition-transform", closed && "-rotate-90")} />
                </button>
              )}
              {(!closed || mini) && <div className="flex flex-col gap-0.5">{g.items.map((n) => item(n, g))}</div>}
            </div>
          );
        })}
        {q && !groups.length && <p className="px-2.5 text-[12px] text-muted">Cap opció del menú coincideix amb «{q}».</p>}
      </div>
      {!mini && <div className="mt-auto space-y-2">
        {repo?.variant === "demo" && snap && <UserSwitcher />}
        <SyncStatus />
      </div>}
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className={cn("hidden shrink-0 border-r border-line bg-surface transition-[width] duration-200 lg:block", prefs.mini ? "w-[68px]" : "w-[252px]")}>{sidebar}</aside>
      <AnimatePresence>
        {mobileNav && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/30 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileNav(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 w-[270px] border-r border-line bg-surface lg:hidden" initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}>{sidebar}</motion.aside>
          </>
        )}
      </AnimatePresence>
      <div className="flex min-w-0 flex-1 flex-col">
        {repo?.variant === "unconfigured" && (
          <button onClick={() => { set("view", "ajustes"); }} className="border-b border-red-500/25 bg-red-500/[0.08] px-4 py-1.5 text-center text-[11.5px] font-medium text-red-700 dark:text-red-300">
            Supabase no està configurat en aquest desplegament: sense inici de sessió, la IA, la sincronització amb Google, el correu i els usuaris no funcionen. Mira el diagnòstic a Configuració → Integracions.
          </button>
        )}
        {repo?.variant === "demo" && (
          <div className="flex items-center justify-center gap-2 border-b border-amber-500/25 bg-amber-500/[0.08] px-4 py-1.5 text-center text-[11.5px] text-amber-800 dark:text-amber-200">
            <span className="sm:hidden">Mode local: canvis desats en aquest navegador.</span>
            <span className="hidden sm:inline">Mode local: els canvis només es desen en aquest navegador. El correu, la IA i la sincronització automàtica s'activen en desplegar amb credencials.</span>
          </div>
        )}
        <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur sm:px-6">
          <button aria-label="Menú" className="pressable -ml-1 rounded-md p-1.5 lg:hidden" onClick={() => setMobileNav(true)}><Menu size={19} /></button>
          <div className="lg:hidden"><Logo compact /></div>
          <BackButton />
          <div className="hidden min-w-0 flex-col sm:flex">
            <h1 className="truncate text-[15px] font-semibold leading-tight">{TITLES[view] && view !== "ajustes" ? TITLES[view] : NAV.find((n) => n.key === current)?.label ?? TITLES[view]}</h1>
            <Breadcrumbs />
          </div>
          <ThemeChip />
          <GlobalSearch />
          <RecentMenu />
          <CopilotButton />
          <NotificationsBell />
          <button aria-label={dark ? "Mode clar" : "Mode fosc"} onClick={() => set("dark", !dark)} className="pressable rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink">
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <UserMenu />
        </header>
        <ThemeRibbon />
        <main id={NAV_MAIN_ID} className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</main>
        <AmbientLayer />
      </div>
    </div>
  );
}


function UserSwitcher() {
  const { snap, switchUser } = useApp();
  return (
    <label className="block rounded-lg border border-dashed border-line p-2">
      <span className="mb-1 block text-[10.5px] text-muted">Veure com a (demo de permisos)</span>
      <select className="input h-8 py-1 text-[12.5px]" value={snap!.me.id} onChange={(e) => switchUser(e.target.value)}>
        {snap!.users.map((u) => <option key={u.id} value={u.id}>{u.name} · {ROLE_LABEL[u.role]}</option>)}
      </select>
    </label>
  );
}

function SyncStatus() {
  const { snap, integrations, syncRemote, set, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const ls = snap?.lastSync;
  const run = async () => {
    if (!integrations.googleSync) { set("view", "ajustes"); return; }
    setBusy(true);
    try { await syncRemote(); } catch (e) { toast({ title: "Error de sincronització", body: e instanceof Error ? e.message : String(e), tone: "err" }); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-lg bg-elevated p-2.5 text-[11.5px]">
      <div className="flex items-center gap-1.5 font-medium"><FileSpreadsheet size={13} className="text-brand" /> Origen de les dades</div>
      <p className="mt-0.5 line-clamp-2 text-muted">{ls ? `${ls.origin} · ${fmtDateTime(ls.at)}` : "Sense sincronitzar"}</p>
      <button onClick={run} disabled={busy} className="pressable mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surface py-1.5 font-medium hover:border-ink/25">
        <RefreshCw size={12} className={cn(busy && "animate-spin")} /> {integrations.googleSync ? "Sincronitza ara" : "Importa / sincronitza"}
      </button>
    </div>
  );
}

type SearchKind = "client" | "supply" | "expedient" | "incident" | "lead" | "opportunity" | "partner";
const GROUP_ORDER: SearchKind[] = ["client", "supply", "expedient", "incident", "opportunity", "lead", "partner"];
const GROUP_LABEL: Record<SearchKind, string> = { client: "Clients", supply: "Punts de subministrament (CUPS)", expedient: "Expedients", incident: "Incidències", opportunity: "Oportunitats", lead: "Leads", partner: "Col·laboradors" };
/** Agrupa els resultats per tipus (màx. 3 per grup, 9 en total) sense duplicar el mateix registre. */
function groupHits<T extends { kind: SearchKind; id: string; title: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const k of GROUP_ORDER) {
    let n = 0;
    for (const r of rows) {
      if (r.kind !== k || n >= 3) continue;
      const key = `${k}:${r.id}:${k === "supply" ? r.title : ""}`;
      if (seen.has(key)) continue;
      seen.add(key); out.push(r); n++;
    }
  }
  return out.slice(0, 9);
}
function openHit(kind: SearchKind, id: string, title: string) {
  const st = useApp.getState();
  if (kind === "supply") st.openSupply(title);
  else if (kind === "expedient") st.navigate("expedient", { id });
  else if (kind === "incident") st.navigate("client", { id, tab: "incidencies" });
  else if (kind === "opportunity") st.navigate("oportunitat", { id });
  else if (kind === "lead") st.navigate("leads", { id });
  else if (kind === "partner") st.navigate("captacio");
  else st.navigate("client", { id });
}

function GlobalSearch() {
  const { search, set, contracts, open } = useApp();
  const [focus, setFocus] = useState(false);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ref.current?.focus(); }
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") { e.preventDefault(); ref.current?.focus(); }
    };
    const f = () => setTimeout(() => ref.current?.focus(), 50);
    window.addEventListener("keydown", h);
    window.addEventListener(NAV_EVENT.search, f);
    return () => { window.removeEventListener("keydown", h); window.removeEventListener(NAV_EVENT.search, f); };
  }, []);
  const contractHits = useMemo(() => (search.length >= 2 ? contracts.filter((c) => matchesSearch(c, search)).slice(0, 6) : []), [search, contracts]);
  // Clients 360°: cerca al servidor (només els clients que l'usuari pot veure)
  const [crmHits, setCrmHits] = useState<{ kind: SearchKind; id: string; title: string; sub: string }[]>([]);
  useEffect(() => {
    if (search.trim().length < 2 || !supabaseConfigured) { setCrmHits([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/crm/search?q=${encodeURIComponent(search.trim())}`, { signal: ctl.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((j: { results?: typeof crmHits }) => setCrmHits(groupHits(j.results ?? [])))
        .catch(() => undefined);
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [search]);
  type Hit = { type: "crm"; key: string; id: string; title: string; sub: string; kind: SearchKind; supply: boolean; expedient?: boolean } | { type: "contract"; key: string; c: (typeof contracts)[number] };
  const results: Hit[] = [
    ...crmHits.map((h, i) => ({ type: "crm" as const, key: `crm-${h.kind}-${h.id}-${i}`, id: h.id, title: h.title, sub: h.sub, kind: h.kind, supply: h.kind === "supply", expedient: h.kind === "expedient" })),
    ...contractHits.map((c) => ({ type: "contract" as const, key: c.id, c })),
  ];
  const pick = (h: Hit) => {
    if (h.type === "crm") openHit(h.kind, h.id, h.title);
    else open(h.c.id);
    setFocus(false);
    ref.current?.blur();
  };
  return (
    <div className="relative ml-auto w-full max-w-md">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        ref={ref}
        value={search}
        onChange={(e) => { set("search", e.target.value); setSel(0); }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          if (e.key === "Enter" && results[sel]) pick(results[sel]);
          if (e.key === "Escape") { set("search", ""); ref.current?.blur(); }
        }}
        placeholder="Cerca client, CUPS, NIF, telèfon…"
        className="input h-9 pl-9 pr-14"
        aria-label="Cercador global"
      />
      {search ? (
        <button aria-label="Esborrar" onClick={() => set("search", "")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"><X size={14} /></button>
      ) : (
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[10.5px] text-muted sm:block">Ctrl K</kbd>
      )}
      <AnimatePresence>
        {focus && results.length > 0 && (
          <motion.ul initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: EASE_OUT }}
            className="absolute left-0 right-0 top-11 z-30 origin-top overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lift">
            {results.map((h, i) => {
              if (h.type === "crm") {
                const prev = results[i - 1];
                const head = !prev || prev.type !== "crm" || prev.kind !== h.kind;
                return (
                  <li key={h.key}>
                    {head && <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{GROUP_LABEL[h.kind]}</p>}
                    <button onMouseDown={() => pick(h)} onMouseEnter={() => setSel(i)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left", i === sel && "bg-ink/[0.05]")}>
                      <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-brand/10 text-brand">{h.expedient ? <FileStack size={12} /> : h.supply ? <Zap size={12} /> : <Users size={12} />}</span>
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-[13px] font-medium", h.supply && "font-mono")}>{h.title}</p>
                        <p className="truncate text-[11px] text-muted">{h.sub || "Client"}</p>
                      </div>
                      <span className="text-[11px] text-muted">{h.supply ? "Punt" : "Obre"}</span>
                    </button>
                  </li>
                );
              }
              const c = h.c;
              const d = daysUntil(expiry(c));
              return (
                <li key={h.key}>
                  {i === crmHits.length && <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">Renovacions</p>}
                  <button onMouseDown={() => pick(h)} onMouseEnter={() => setSel(i)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left", i === sel && "bg-ink/[0.05]")}>
                    <SupplierMark name={c.comercializadora} size={22} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{titleCase(c.cliente)}</p>
                      <p className="truncate text-[11px] text-muted">{c.poblacion} · {c.cups ?? c.cif}</p>
                    </div>
                    <span className="text-[11px]" style={{ color: STATUS_META[c.crm.status].color }}>{c.crm.status === "pendiente" || c.crm.status === "contactado" ? relDays(d) : STATUS_META[c.crm.status].label}</span>
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
