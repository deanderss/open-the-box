import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError, requireGroupMod } from "@/lib/api";
import { json } from "@/lib/util";
import { purgeGroupUploads } from "@/lib/uploads";

export const PATCH = handle(async (req, { params }) => {
  await requireGroupMod(params.id);
  const { name, color, emoji } = await body<{ name?: string; color?: string; emoji?: string }>(req);
  const patch: Record<string, string> = {};
  if (name?.trim()) patch.name = name.trim().slice(0, 60);
  if (color) patch.color = color;
  if (emoji) patch.emoji = emoji.slice(0, 8);
  await supabaseAdmin().from("groups").update(patch).eq("id", params.id);
  return json({ ok: true });
});

export const DELETE = handle(async (_req, { params }) => {
  const { role } = await requireGroupMod(params.id);
  if (role !== "owner") throw new HttpError(403, "Only the box owner can delete it");
  await purgeGroupUploads([params.id]);
  await supabaseAdmin().from("groups").delete().eq("id", params.id);
  return json({ ok: true });
});
