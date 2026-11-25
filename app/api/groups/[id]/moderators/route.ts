import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError, requireGroupMod } from "@/lib/api";
import { json } from "@/lib/util";

export const POST = handle(async (req, { params }) => {
  await requireGroupMod(params.id);
  const { email } = await body<{ email?: string }>(req);
  const e = (email || "").trim().toLowerCase();
  const db = supabaseAdmin();
  const { data: mod } = await db.from("moderators").select("id").ilike("email", e).maybeSingle();
  if (!mod) throw new HttpError(404, "No moderator account with that email — they need to sign up first");
  await db.from("group_moderators").upsert({ group_id: params.id, moderator_id: mod.id, role: "co" }, { onConflict: "group_id,moderator_id", ignoreDuplicates: true });
  return json({ ok: true });
});

export const DELETE = handle(async (req, { params }) => {
  const { uid, role } = await requireGroupMod(params.id);
  const modId = new URL(req.url).searchParams.get("moderatorId");
  if (!modId) throw new HttpError(400, "Missing moderator");
  if (role !== "owner" && modId !== uid) throw new HttpError(403, "Only the owner can remove co-moderators");
  await supabaseAdmin().from("group_moderators").delete().eq("group_id", params.id).eq("moderator_id", modId).eq("role", "co");
  return json({ ok: true });
});
