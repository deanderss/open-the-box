import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, requireGroupMod, check } from "@/lib/api";
import { json, randomToken } from "@/lib/util";

export const POST = handle(async (_req, { params }) => {
  await requireGroupMod(params.id);
  const token = randomToken();
  check(await supabaseAdmin().from("groups").update({ submit_token: token }).eq("id", params.id));
  return json({ token });
});
