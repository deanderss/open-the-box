import { supabaseAdmin } from "@/lib/supabase-server";
import { json } from "@/lib/util";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);
  const { data, error } = await supabaseAdmin().rpc("ping");
  return json({ ok: !error, data, at: new Date().toISOString() });
}
