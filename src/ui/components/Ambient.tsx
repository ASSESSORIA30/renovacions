"use client";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { THEMES, themeFor, type Theme } from "@/core/seasons";
import { today } from "@/core/dates";
import { useApp } from "@/data/store";
import { EASE_OUT, cn } from "./ui";

export function useTheme(): Theme {
  const preview = useApp((s) => s.themePreview);
  return useMemo(() => (preview && THEMES[preview]) || themeFor(today()), [preview]);
}

interface P { id: number; e: string; x: number; y: number; size: number; dur: number; delay: number; sway: number; spin: number; op: number; loop: boolean }

function particles(t: Theme, n: number, intro: boolean, seed: number): P[] {
  if (!t.particles.length || n <= 0) return [];
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: n }, (_, i) => {
    const burst = t.motion === "burst";
    return {
      id: seed * 1000 + i,
      e: t.particles[Math.floor(rnd() * t.particles.length)],
      x: rnd() * 100,
      y: burst ? 8 + rnd() * 70 : t.motion === "drift" ? 10 + rnd() * 75 : 0,
      size: intro ? 18 + rnd() * 18 : 14 + rnd() * 8,
      dur: burst ? 1.4 + rnd() * 1.2 : intro ? 5 + rnd() * 3.5 : 16 + rnd() * 12,
      delay: intro ? rnd() * (burst ? 3.5 : 2.2) : rnd() * 18,
      sway: (rnd() - 0.5) * 60,
      spin: (rnd() - 0.5) * 540,
      op: intro ? 0.95 : 0.4,
      loop: !intro,
    };
  });
}

/** Full-screen, click-through layer: an intro shower when the app opens (or on demand), then a few slow ambient particles. */
export function AmbientLayer() {
  const t = useTheme();
  const { ambient, ambientRun } = useApp();
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    setIntro(true);
    const id = setTimeout(() => setIntro(false), t.motion === "burst" ? 5500 : 8500);
    return () => clearTimeout(id);
  }, [ambientRun, t.id, t.motion]);
  const introPs = useMemo(() => particles(t, t.motion === "burst" ? 22 : 30, true, ambientRun + 7), [t, ambientRun]);
  const loopPs = useMemo(() => particles(t, t.density, false, 3), [t]);
  if (!ambient) return null;
  return (
    <div className="amb-layer pointer-events-none fixed inset-0 z-30 overflow-hidden" aria-hidden>
      {(intro ? introPs : loopPs).map((p) => (
        <span
          key={p.id}
          className={cn("amb-p", `amb-${t.motion}`, p.loop && "amb-loop")}
          style={{
            left: `${p.x}vw`, top: t.motion === "burst" || t.motion === "drift" ? `${p.y}vh` : 0, fontSize: p.size,
            ["--dur" as string]: `${p.dur}s`, ["--delay" as string]: `${p.delay}s`, ["--sway" as string]: `${p.sway}px`,
            ["--spin" as string]: `${p.spin}deg`, ["--op" as string]: String(p.op),
            ...(t.motion === "drift" ? { left: 0 } : {}),
          }}
        >
          {p.e}
        </span>
      ))}
    </div>
  );
}

/** Thin ribbon under the header with the theme colours (stripes for the Diada). */
export function ThemeRibbon() {
  const t = useTheme();
  const { ambient } = useApp();
  if (!ambient) return null;
  const bg = t.stripes
    ? `repeating-linear-gradient(90deg, ${t.accent[0]} 0 18px, ${t.accent[1]} 18px 36px)`
    : `linear-gradient(90deg, ${t.accent[0]}, ${t.accent[1]})`;
  return <div className="h-[3px] w-full shrink-0" style={{ background: bg }} aria-hidden />;
}

/** Header chip: name of the festivity/season; click replays the animation. */
export function ThemeChip() {
  const t = useTheme();
  const { ambient, set, ambientRun } = useApp();
  const [hover, setHover] = useState(false);
  if (!ambient) return null;
  return (
    <div className="relative hidden md:block" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        onClick={() => set("ambientRun", ambientRun + 1)}
        className="pressable inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-medium hover:border-ink/25"
        title="Repetir l'animació"
      >
        <span className="text-[15px] leading-none">{t.icon}</span>{t.name}
      </button>
      <AnimatePresence>
        {hover && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: EASE_OUT }}
            className="absolute left-0 top-9 z-40 w-64 rounded-xl border border-line bg-surface p-3 text-[12px] shadow-lift">
            <p className="font-medium">{t.greeting}</p>
            <p className="mt-1 text-muted">Clica per tornar a veure l'animació. Es pot desactivar a Configuració → Empresa i PDF.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
