import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError, requireAdmin } from "@/lib/api";
import { json } from "@/lib/util";

export const POST = handle(async (req) => {
  await requireAdmin();
  const { maxModerators } = await body<{ maxModerators?: number }>(req);
  const m = Number(maxModerators);
  if (!Number.isInteger(m) || m < 1 || m > 50) throw new HttpError(400, "Pick a cap between 1 and 50");
  await supabaseAdmin().from("app_settings").update({ max_moderators: m }).eq("id", 1);
  return json({ ok: true });
});
