import { supabaseAdmin } from "./supabase-server";
import { HttpError } from "./api";
import { uploadsEnabled } from "./uploads";

export async function groupByToken(token: string | null) {
  if (!token || token.length < 16) throw new HttpError(404, "This link is invalid or has been replaced");
  const { data } = await supabaseAdmin().from("groups").select("id,name,color,emoji").eq("submit_token", token).maybeSingle();
  if (!data) throw new HttpError(404, "This link is invalid or has been replaced");
  return data;
}

export type SubmitLookup = {
  group: { name: string; color: string; emoji: string };
  roster: { id: string; name: string; color: string }[];
  uploadsEnabled: boolean;
};

/**
 * Everything the submit page needs to render immediately: whose box this link belongs to and who's on the
 * roster. Shared by the page itself (rendered server-side, so this never shows a "Finding the box…" spinner
 * or pays for a client round trip just to learn something that was already known the instant the request
 * came in) and the `GET /api/submit` route (kept around for the page's own "something went wrong, try again"
 * retry, since that has to happen from the client) — one place, so the two can't quietly drift apart.
 */
export async function loadSubmitPage(token: string | null): Promise<SubmitLookup> {
  const g = await groupByToken(token);
  const { data: roster } = await supabaseAdmin()
    .from("players")
    .select("id,display_name,avatar_color")
    .eq("group_id", g.id)
    .eq("active", true)
    .order("display_name");
  return {
    uploadsEnabled: uploadsEnabled(),
    group: { name: g.name, color: g.color, emoji: g.emoji },
    roster: (roster || []).map((p) => ({ id: p.id, name: p.display_name, color: p.avatar_color })),
  };
}
