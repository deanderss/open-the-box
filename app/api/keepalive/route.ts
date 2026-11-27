import { supabaseAdmin } from "@/lib/supabase-server";
import { json } from "@/lib/util";
import { sweepOrphanedUploads } from "@/lib/uploads";
import { endStaleSessions } from "@/lib/game";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);
  const { data, error } = await supabaseAdmin().rpc("ping");
  // Best-effort daily housekeeping, piggybacked on the cron that's already pinging the DB once a day to keep
  // the free-plan project from being paused for inactivity — each failing independently of the others and of
  // the ping itself, so one bad sweep never turns the whole keepalive red.
  const [orphanedUploads, staleSessions] = await Promise.all([sweepOrphanedUploads().catch(() => null), endStaleSessions().catch(() => null)]);
  return json({ ok: !error, data, orphanedUploads, staleSessions, at: new Date().toISOString() });
}
