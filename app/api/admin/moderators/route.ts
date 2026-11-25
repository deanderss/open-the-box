import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, HttpError, requireAdmin } from "@/lib/api";
import { json } from "@/lib/util";

export const DELETE = handle(async (req) => {
  const uid = await requireAdmin();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "Missing moderator");
  if (id === uid) throw new HttpError(400, "You can't remove yourself");
  const db = supabaseAdmin();
  // Hand owned boxes to a co-moderator if possible; otherwise to the admin
  const { data: owned } = await db.from("groups").select("id").eq("owner_id", id);
  for (const g of owned || []) {
    const { data: co } = await db.from("group_moderators").select("moderator_id").eq("group_id", g.id).neq("moderator_id", id).limit(1).maybeSingle();
    const heir = co?.moderator_id || uid;
    await db.from("groups").update({ owner_id: heir }).eq("id", g.id);
    await db.from("group_moderators").upsert({ group_id: g.id, moderator_id: heir, role: "owner" }, { onConflict: "group_id,moderator_id" });
  }
  const { error } = await db.auth.admin.deleteUser(id);
  if (error) throw new HttpError(400, error.message);
  return json({ ok: true });
});
