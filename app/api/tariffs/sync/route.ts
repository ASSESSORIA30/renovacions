import { handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { configuredConnectors, syncAllConnectors } from "@/server/connectors";

export const maxDuration = 60;

export const GET = handler(async () => {
  const u = await requireInternal({ staff: true });
  const { data } = await u.sb.from("tariff_connector_runs").select("*").order("started_at", { ascending: false }).limit(30);
  return { connectors: configuredConnectors().map((c) => ({ providerId: c.providerId, name: c.name })), runs: data ?? [] };
});

/** Sincronització manual dels connectors autoritzats (també s'executa al cron diari). */
export const POST = handler(async () => {
  await requireInternal({ staff: true });
  return { results: await syncAllConnectors() };
});
