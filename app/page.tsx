"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import App from "@/ui/App";
import { createLocalRepo } from "@/data/localRepo";
import { createSupabaseRepo } from "@/data/supabaseRepo";
import { browserSupabase, supabaseConfigured } from "@/data/browserSupabase";

/**
 * Production: Supabase repository (login required, permissions enforced by RLS).
 * Without Supabase env vars (local development): browser-only repository with NO data —
 * import the Excel files from Ajustes → Datos. No fake data is ever injected.
 */
export default function Page() {
  const router = useRouter();
  const [ok, setOk] = useState(!supabaseConfigured);
  const repo = useMemo(
    () => (supabaseConfigured ? createSupabaseRepo(browserSupabase()) : createLocalRepo({ importedAt: new Date().toISOString(), report: null as never, contracts: [], origin: "Sense dades: importa els Excel a Configuració" }, "unconfigured")),
    []
  );
  useEffect(() => {
    if (!supabaseConfigured) return;
    browserSupabase().auth.getUser().then(({ data }) => (data.user ? setOk(true) : router.replace("/login")));
  }, [router]);
  if (!ok) return null;
  return <App repo={repo} />;
}
