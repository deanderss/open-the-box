import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError, requireAdmin, check } from "@/lib/api";
import { json } from "@/lib/util";

// Approve or deny a pending moderator request. Admin only.
export const POST = handle(async (req) => {
  const adminId = await requireAdmin();
  const { id, action } = await body<{ id?: string; action?: string }>(req);
  if (!id || (action !== "approve" && action !== "deny")) throw new HttpError(400, "Pick a request and an action");
  const db = supabaseAdmin();

  const { data: r } = await db.from("moderator_requests").select("id,user_id,status").eq("id", id).maybeSingle();
  if (!r) throw new HttpError(404, "Request not found");
  if (r.status !== "pending") throw new HttpError(409, `Already ${r.status}`);

  if (action === "approve") {
    if (!r.user_id) throw new HttpError(409, "This account no longer exists");
    const { error } = await db.auth.admin.updateUserById(r.user_id, { ban_duration: "none" });
    if (error) throw new HttpError(400, error.message);
    check(await db.from("moderators").update({ approved: true }).eq("id", r.user_id));
  } else if (r.user_id) {
    // Deleting the blocked account frees its seat; the request row keeps the history.
    const { error } = await db.auth.admin.deleteUser(r.user_id);
    if (error && !/not found/i.test(error.message)) throw new HttpError(400, error.message);
  }

  await db
    .from("moderator_requests")
    .update({ status: action === "approve" ? "approved" : "denied", decided_at: new Date().toISOString(), decided_by: adminId })
    .eq("id", id)
    .eq("status", "pending");
  return json({ ok: true });
});
