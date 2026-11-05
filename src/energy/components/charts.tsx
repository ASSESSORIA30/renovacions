"use client";
import dynamic from "next/dynamic";
import { useTheme } from "@/energy/compat/theme";
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { MONTHS_SHORT } from "@/energy/lib/columns";
import { fmt } from "@/energy/lib/format";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-surface-2/50" /> });

export function useTokens() {
  const { resolvedTheme } = useTheme();
  const [tokens, setTokens] = useState<Record<string, string>>({});
  useEffect(() => {
    // El shell aplica la classe .dark en un efecte: es llegeixen els colors al fotograma següent.
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      // Els tokens de la plataforma són triplets RGB ("14 124 134") per a Tailwind; ECharts necessita hex.
      const g = (k: string) => {
        const v = cs.getPropertyValue(k).trim();
        const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/.exec(v);
        return m ? "#" + m.slice(1).map((n) => Number(n).toString(16).padStart(2, "0")).join("") : v;
      };
      setTokens({ fg: g("--fg"), fg2: g("--fg-2"), fg3: g("--fg-3"), border: g("--border"), surface: g("--bg-elev"), s1: g("--s1"), s2: g("--s2"), s3: g("--s3"), s4: g("--s4"), s5: g("--s5"), s7: g("--s7"), accent: g("--accent"), critical: g("--critical"), warning: g("--warning"), good: g("--good") });
    };
    const id = requestAnimationFrame(read);
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);
  return tokens;
}

function base(t: Record<string, string>): EChartsOption {
  return {
    animationDuration: 700,
    animationEasing: "cubicOut",
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    textStyle: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", color: t.fg2 },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.surface,
      borderColor: t.border,
      textStyle: { color: t.fg, fontSize: 12 },
      axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } },
    },
    legend: { top: 0, right: 0, textStyle: { color: t.fg2, fontSize: 11 }, itemWidth: 10, itemHeight: 10, icon: "roundRect" },
    xAxis: { type: "category", axisLine: { lineStyle: { color: t.border } }, axisTick: { show: false }, axisLabel: { color: t.fg3, fontSize: 11 } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: t.border, type: [3, 4] } }, axisLabel: { color: t.fg3, fontSize: 11, formatter: (v: number) => fmt.n(v) } },
  };
}

export function Chart({ option, height = 260 }: { option: EChartsOption; height?: number }) {
  return <ReactECharts option={option} style={{ height, width: "100%" }} notMerge lazyUpdate opts={{ renderer: "svg" }} />;
}

const valFmt = (unit: string, d = 0) => (v: unknown) => (v == null || v === "-" ? "Sin dato" : `${fmt.n(Number(v), d)} ${unit}`);

export function MonthlyBars({ values, unit, name, color = "s1", decimals = 0, refLines = [] }: { values: (number | null)[]; unit: string; name: string; color?: string; decimals?: number; refLines?: { label: string; value: number; color?: string }[] }) {
  const t = useTokens();
  const option = useMemo<EChartsOption>(() => {
    const b = base(t);
    return {
      ...b,
      legend: { show: false },
      tooltip: { ...(b.tooltip as object), valueFormatter: valFmt(unit, decimals) },
      xAxis: { ...(b.xAxis as object), data: MONTHS_SHORT, axisLabel: { color: t.fg3, fontSize: 11, interval: 0 } },
      series: [
        {
          name,
          type: "bar",
          data: values.map((v) => (v == null ? "-" : v)),
          barMaxWidth: 26,
          itemStyle: { color: t[color], borderRadius: [4, 4, 0, 0] },
          emphasis: { itemStyle: { opacity: 0.85 } },
          markLine: refLines.length
            ? {
                symbol: "none",
                label: { color: t.fg2, fontSize: 10, formatter: "{b}", position: "insideEndTop" },
                data: refLines.map((r) => ({ name: `${r.label}: ${fmt.n(r.value, decimals)} ${unit}`, yAxis: r.value, lineStyle: { color: r.color ? t[r.color] : t.fg3, type: "dashed", width: 1.5 } })),
              }
            : undefined,
        },
      ],
    };
  }, [t, values, unit, name, color, decimals, refLines]);
  return <Chart option={option} />;
}

export function MonthlyLine({ values, unit, name, refLines = [], decimals = 1 }: { values: (number | null)[]; unit: string; name: string; refLines?: { label: string; value: number; color?: string }[]; decimals?: number }) {
  const t = useTokens();
  const option = useMemo<EChartsOption>(() => {
    const b = base(t);
    const max = Math.max(0, ...values.map((v) => v ?? 0), ...refLines.map((r) => r.value));
    return {
      ...b,
      legend: { show: false },
      tooltip: { ...(b.tooltip as object), axisPointer: { type: "line", lineStyle: { color: t.fg3 } }, valueFormatter: valFmt(unit, decimals) },
      xAxis: { ...(b.xAxis as object), data: MONTHS_SHORT, boundaryGap: false },
      yAxis: { ...(b.yAxis as object), max: Math.ceil(max * 1.12) },
      series: [
        {
          name,
          type: "line",
          data: values.map((v) => (v == null ? "-" : v)),
          smooth: 0.25,
          symbolSize: 8,
          lineStyle: { width: 2, color: t.s1 },
          itemStyle: { color: t.s1, borderColor: t.surface, borderWidth: 2 },
          areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: t.s1 + "40" }, { offset: 1, color: t.s1 + "00" }] } },
          markLine: {
            symbol: "none",
            label: { color: t.fg2, fontSize: 10, formatter: "{b}", position: "insideEndTop" },
            data: refLines.map((r) => ({ name: `${r.label} ${fmt.n(r.value, 1)} ${unit}`, yAxis: r.value, lineStyle: { color: r.color ? t[r.color] : t.fg3, type: "dashed", width: 1.5 } })),
          },
        },
      ],
    };
  }, [t, values, unit, name, refLines, decimals]);
  return <Chart option={option} />;
}

export interface PeriodSeries {
  name: string;
  values: (number | null)[];
  color: string;
  dashed?: boolean;
}
export function PeriodBars({ series, n = 6, unit = "kW", height = 260 }: { series: PeriodSeries[]; n?: number; unit?: string; height?: number }) {
  const t = useTokens();
  const option = useMemo<EChartsOption>(() => {
    const b = base(t);
    return {
      ...b,
      tooltip: { ...(b.tooltip as object), valueFormatter: valFmt(unit, 1) },
      xAxis: { ...(b.xAxis as object), data: Array.from({ length: n }, (_, i) => `P${i + 1}`) },
      series: series.map((s) => ({
        name: s.name,
        type: "bar",
        data: s.values.slice(0, n).map((v) => (v == null ? "-" : v)),
        barMaxWidth: 22,
        barGap: "12%",
        itemStyle: s.dashed ? { color: "transparent", borderColor: t[s.color], borderWidth: 1.5, borderType: "dashed", borderRadius: [4, 4, 0, 0] } : { color: t[s.color], borderRadius: [4, 4, 0, 0] },
      })),
    };
  }, [t, series, n, unit]);
  return <Chart option={option} height={height} />;
}

export function RatioLine({ values }: { values: (number | null)[] }) {
  const t = useTokens();
  const option = useMemo<EChartsOption>(() => {
    const b = base(t);
    const data = values.map((v) => (v == null ? "-" : Math.round(v * 1000) / 10));
    return {
      ...b,
      legend: { show: false },
      tooltip: { ...(b.tooltip as object), axisPointer: { type: "line" }, valueFormatter: (v: unknown) => (v === "-" || v == null ? "Sin dato" : `${fmt.n(Number(v), 1)} %`) },
      xAxis: { ...(b.xAxis as object), data: MONTHS_SHORT, boundaryGap: false },
      yAxis: { ...(b.yAxis as object), axisLabel: { color: t.fg3, fontSize: 11, formatter: "{value} %" }, max: (v: { max: number }) => Math.max(90, Math.ceil(v.max / 10) * 10) },
      series: [
        {
          name: "R/A",
          type: "line",
          data,
          symbolSize: 8,
          lineStyle: { width: 2, color: t.s2 },
          itemStyle: { color: t.s2, borderColor: t.surface, borderWidth: 2 },
          markArea: { silent: true, data: [[{ yAxis: 33, itemStyle: { color: t.warning + "14" } }, { yAxis: 75 }], [{ yAxis: 75, itemStyle: { color: t.critical + "14" } }, { yAxis: 1000 }]] },
          markLine: {
            symbol: "none",
            label: { color: t.fg2, fontSize: 10, formatter: "{b}", position: "insideEndTop" },
            data: [
              { name: "33 % (cos φ 0,95)", yAxis: 33, lineStyle: { color: t.warning, type: "dashed" } },
              { name: "75 % (cos φ 0,80)", yAxis: 75, lineStyle: { color: t.critical, type: "dashed" } },
            ],
          },
        },
      ],
    };
  }, [t, values]);
  return <Chart option={option} height={220} />;
}

export function HBarScores({ items }: { items: { label: string; value: number }[] }) {
  const t = useTokens();
  const option = useMemo<EChartsOption>(() => {
    const b = base(t);
    return {
      ...b,
      legend: { show: false },
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      tooltip: { ...(b.tooltip as object), valueFormatter: (v: unknown) => fmt.n(Number(v)) },
      yAxis: { type: "category", data: items.map((i) => i.label), axisLabel: { color: t.fg2, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
      xAxis: { type: "value", splitLine: { lineStyle: { color: t.border, type: [3, 4] } }, axisLabel: { color: t.fg3, fontSize: 10, formatter: (v: number) => fmt.n(v) } },
      series: [{ type: "bar", data: items.map((i) => i.value), barMaxWidth: 14, itemStyle: { color: t.s1, borderRadius: [0, 4, 4, 0] } }],
    };
  }, [t, items]);
  return <Chart option={option} height={Math.max(160, items.length * 30)} />;
}
