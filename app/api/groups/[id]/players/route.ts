import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError, requireGroupMod } from "@/lib/api";
import { json, AVATAR_COLORS } from "@/lib/util";

export const POST = handle(async (req, { params }) => {
  await requireGroupMod(params.id);
  const { name } = await body<{ name?: string }>(req);
  const n = (name || "").trim().slice(0, 40);
  if (!n) throw new HttpError(400, "Enter a name");
  const db = supabaseAdmin();
  const { data: settings } = await db.from("app_settings").select("max_players_per_group").eq("id", 1).single();
  const { count } = await db.from("players").select("*", { count: "exact", head: true }).eq("group_id", params.id).eq("active", true);
  if ((count ?? 0) >= (settings?.max_players_per_group ?? 30)) throw new HttpError(403, "Roster is full");
  const { data: existing } = await db.from("players").select("id,active").eq("group_id", params.id).eq("display_name", n).maybeSingle();
  if (existing) {
    if (existing.active) throw new HttpError(409, "That name is already on the roster");
    await db.from("players").update({ active: true }).eq("id", existing.id);
    return json({ ok: true });
  }
  await db.from("players").insert({ group_id: params.id, display_name: n, avatar_color: AVATAR_COLORS[(count ?? 0) % AVATAR_COLORS.length] });
  return json({ ok: true });
});

export const DELETE = handle(async (req, { params }) => {
  await requireGroupMod(params.id);
  const playerId = new URL(req.url).searchParams.get("playerId");
  if (!playerId) throw new HttpError(400, "Missing player");
  // soft-remove to keep history/leaderboard intact
  await supabaseAdmin().from("players").update({ active: false }).eq("id", playerId).eq("group_id", params.id);
  return json({ ok: true });
});
