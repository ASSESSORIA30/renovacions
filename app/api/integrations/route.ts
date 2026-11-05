import { integrations } from "@/server/env";
import { smtpReady } from "@/server/mailer";
import { handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const GET = handler(async () => {
  await requireInternal();
  return { ...integrations(), smtp: await smtpReady() };
});
