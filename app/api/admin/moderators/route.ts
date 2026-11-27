import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError, requireAdmin, check } from "@/lib/api";
import { json } from "@/lib/util";
import { purgeGroupUploads } from "@/lib/uploads";

const BLOCKED = "876000h"; // ~100 years

async function loadTarget(id: string, adminId: string) {
  if (id === adminId) throw new HttpError(400, "You can't do that to your own account");
  const { data } = await supabaseAdmin().from("moderators").select("id,is_admin").eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, "Moderator not found");
  if (data.is_admin) throw new HttpError(400, "You can't do that to the admin account");
  return data;
}

/** Suspend (blocks login and all actions, keeps their boxes) or reactivate a moderator. */
export const POST = handle(async (req) => {
  const adminId = await requireAdmin();
  const { id, action } = await body<{ id?: string; action?: string }>(req);
  if (!id || (action !== "suspend" && action !== "reactivate")) throw new HttpError(400, "Pick a moderator and an action");
  await loadTarget(id, adminId);
  const db = supabaseAdmin();
  const suspend = action === "suspend";
  const { error } = await db.auth.admin.updateUserById(id, { ban_duration: suspend ? BLOCKED : "none" });
  if (error) throw new HttpError(400, error.message);
  check(await db.from("moderators").update({ suspended: suspend }).eq("id", id));
  return json({ ok: true });
});

/**
 * Delete a moderator's account.
 *  - default: boxes they own are handed to a co-moderator (or the admin)
 *  - ?boxes=delete: boxes they own are deleted along with the account
 */
export const DELETE = handle(async (req) => {
  const uid = await requireAdmin();
  const q = new URL(req.url).searchParams;
  const id = q.get("id");
  if (!id) throw new HttpError(400, "Missing moderator");
  await loadTarget(id, uid);
  const db = supabaseAdmin();
  const { data: owned } = await db.from("groups").select("id").eq("owner_id", id);
  if (q.get("boxes") === "delete") {
    if (owned?.length) {
      await purgeGroupUploads(owned.map((g) => g.id));
      check(await db.from("groups").delete().in("id", owned.map((g) => g.id)));
    }
  } else {
    for (const g of owned || []) {
      const { data: co } = await db.from("group_moderators").select("moderator_id").eq("group_id", g.id).neq("moderator_id", id).limit(1).maybeSingle();
      const heir = co?.moderator_id || uid;
      check(await db.from("groups").update({ owner_id: heir }).eq("id", g.id));
      check(await db.from("group_moderators").upsert({ group_id: g.id, moderator_id: heir, role: "owner" }, { onConflict: "group_id,moderator_id" }));
    }
  }
  const { error } = await db.auth.admin.deleteUser(id);
  if (error) throw new HttpError(400, error.message);
  return json({ ok: true });
});
