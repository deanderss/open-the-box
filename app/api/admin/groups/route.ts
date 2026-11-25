import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, HttpError, requireAdmin } from "@/lib/api";
import { json } from "@/lib/util";

/** Admin can delete any moderator's box (players, videos, sessions and scores go with it). */
export const DELETE = handle(async (req) => {
  await requireAdmin();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "Missing box");
  const db = supabaseAdmin();
  const { data: g } = await db.from("groups").select("id").eq("id", id).maybeSingle();
  if (!g) throw new HttpError(404, "Box not found");
  const { error } = await db.from("groups").delete().eq("id", id);
  if (error) throw new HttpError(400, error.message);
  return json({ ok: true });
});
