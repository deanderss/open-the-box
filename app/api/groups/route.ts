import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError, requireUser } from "@/lib/api";
import { json, randomToken, AVATAR_COLORS, isHexColor } from "@/lib/util";
import { getSettings } from "@/lib/settings";

export const POST = handle(async (req) => {
  const uid = await requireUser();
  const { name, color, emoji, players } = await body<{ name?: string; color?: string; emoji?: string; players?: string[] }>(req);
  const n = (name || "").trim().slice(0, 60);
  if (!n) throw new HttpError(400, "Give your box a name");
  const db = supabaseAdmin();
  const settings = await getSettings();
  const { count } = await db.from("groups").select("*", { count: "exact", head: true }).eq("owner_id", uid);
  const maxBoxes = settings.max_groups_per_moderator;
  if ((count ?? 0) >= maxBoxes) throw new HttpError(403, `You can own up to ${maxBoxes} boxes`);
  const { data: g, error } = await db
    .from("groups")
    .insert({ name: n, color: isHexColor(color) ? color : "#FF4FA3", emoji: (emoji || "📦").slice(0, 8), owner_id: uid, submit_token: randomToken() })
    .select("id")
    .single();
  if (error || !g) {
    console.error("create box failed", error);
    throw new HttpError(500, "Could not create the box. Please try again.");
  }
  const names = Array.from(new Set((players || []).map((p) => p.trim().slice(0, 40)).filter(Boolean))).slice(0, settings.max_players_per_group);
  if (names.length) {
    // Not fatal: the box already exists, and names can be added on its page. Failing here would just make the
    // moderator create a second box.
    await db.from("players").insert(names.map((p, i) => ({ group_id: g.id, display_name: p, avatar_color: AVATAR_COLORS[i % AVATAR_COLORS.length] })));
  }
  return json({ id: g.id });
});
