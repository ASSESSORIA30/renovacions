"use client";
/** Substitut de `next/navigation` per als components de cups2 (navegació interna, sense canviar d'aplicació). */
import { useMemo } from "react";
import { useApp } from "@/data/store";
import { resolveHref } from "./routes";

export function useRouter() {
  return useMemo(
    () => ({
      push(href: string) {
        const { view, params } = resolveHref(href);
        useApp.getState().navigate(view, params);
      },
      replace(href: string) {
        const { view, params } = resolveHref(href);
        useApp.getState().navigate(view, params, { replace: true });
      },
      back() {
        if (typeof window !== "undefined") window.history.back();
      },
    }),
    [],
  );
}

export function useSearchParams() {
  const params = useApp((s) => s.params);
  return useMemo(() => new URLSearchParams(params), [params]);
}

export function usePathname() {
  return useApp((s) => `/${s.view}`);
}
