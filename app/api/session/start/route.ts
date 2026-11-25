import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError, requireGroupMod } from "@/lib/api";
import { json, roomCode } from "@/lib/util";

export const POST = handle(async (req) => {
  const { groupId } = await body<{ groupId?: string }>(req);
  if (!groupId) throw new HttpError(400, "Missing box");
  const { uid } = await requireGroupMod(groupId);
  const db = supabaseAdmin();
  // Re-use an active (unfinished) session for this box, if one exists
  const { data: existing } = await db
    .from("sessions")
    .select("id,room_code,created_at")
    .eq("group_id", groupId)
    .is("ended_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing && Date.now() - new Date(existing.created_at).getTime() < 6 * 3600 * 1000) {
    return json({ sessionId: existing.id, code: existing.room_code });
  }
  if (existing) await db.from("sessions").update({ state: "finished", ended_at: new Date().toISOString() }).eq("id", existing.id);
  for (let i = 0; i < 8; i++) {
    const code = roomCode();
    const { data, error } = await db.from("sessions").insert({ group_id: groupId, room_code: code, created_by: uid }).select("id").single();
    if (!error && data) return json({ sessionId: data.id, code });
    if (error && error.code !== "23505") throw new HttpError(500, error.message);
  }
  throw new HttpError(500, "Could not allocate a room code");
});
