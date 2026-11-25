import { supabaseAdmin } from "@/lib/supabase-server";
import { json } from "@/lib/util";
export const dynamic = "force-dynamic";
export async function GET() {
  const { data } = await supabaseAdmin().rpc("moderator_slots_remaining");
  return json({ remaining: (data as number) ?? 0 });
}
