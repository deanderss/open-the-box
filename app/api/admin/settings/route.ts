import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError, requireAdmin } from "@/lib/api";
import { json } from "@/lib/util";
import { clearSettingsCache } from "@/lib/settings";

export const POST = handle(async (req) => {
  await requireAdmin();
  const { maxModerators } = await body<{ maxModerators?: number }>(req);
  const m = Number(maxModerators);
  if (!Number.isInteger(m) || m < 1 || m > 50) throw new HttpError(400, "Pick a cap between 1 and 50");
  const { error } = await supabaseAdmin().from("app_settings").update({ max_moderators: m }).eq("id", 1);
  if (error) throw new HttpError(503, "Couldn't save the setting. Try again.");
  clearSettingsCache();
  return json({ ok: true });
});
