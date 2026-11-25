import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError } from "@/lib/api";
import { json } from "@/lib/util";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { extractUrls, parseVideoUrl, needsExpansion, expandUrl } from "@/lib/embeds";
import { checkPlayable, playabilityMessage } from "@/lib/playable";

export const dynamic = "force-dynamic";

async function groupByToken(token: string | null) {
  if (!token || token.length < 16) throw new HttpError(404, "This link is invalid or has been replaced");
  const { data } = await supabaseAdmin().from("groups").select("id,name,color,emoji").eq("submit_token", token).maybeSingle();
  if (!data) throw new HttpError(404, "This link is invalid or has been replaced");
  return data;
}

export const GET = handle(async (req) => {
  if (!rateLimit("submitget:" + clientIp(req), 120, 60 * 60 * 1000)) throw new HttpError(429, "Slow down!");
  const g = await groupByToken(new URL(req.url).searchParams.get("token"));
  const { data: roster } = await supabaseAdmin()
    .from("players")
    .select("id,display_name,avatar_color")
    .eq("group_id", g.id)
    .eq("active", true)
    .order("display_name");
  return json({ group: { name: g.name, color: g.color, emoji: g.emoji }, roster: (roster || []).map((p) => ({ id: p.id, name: p.display_name, color: p.avatar_color })) });
});

export const POST = handle(async (req) => {
  if (!rateLimit("submit:" + clientIp(req), 20, 60 * 60 * 1000)) throw new HttpError(429, "Whoa, that's a lot of videos! Try again in a bit.");
  const { token, playerId, links } = await body<{ token?: string; playerId?: string; links?: string[] | string }>(req);
  const g = await groupByToken(token || null);
  const db = supabaseAdmin();
  const { data: player } = await db.from("players").select("id").eq("id", playerId || "").eq("group_id", g.id).eq("active", true).maybeSingle();
  if (!player) throw new HttpError(400, "Pick your name first");

  const text = Array.isArray(links) ? links.join("\n") : links || "";
  const urls = extractUrls(text).slice(0, 15);
  if (!urls.length) throw new HttpError(400, "Paste at least one TikTok, Instagram, Facebook or YouTube Shorts link");

  const { data: settings } = await db.from("app_settings").select("max_queued_videos_per_group").eq("id", 1).single();
  const { count: queued } = await db.from("videos").select("*", { count: "exact", head: true }).eq("group_id", g.id).eq("status", "queued");
  let room = (settings?.max_queued_videos_per_group ?? 300) - (queued ?? 0);

  const results: { url: string; status: "added" | "duplicate" | "invalid" | "full" | "unplayable"; message?: string }[] = [];
  // Resolve every link first, then ask the platforms (in parallel) whether each video can actually play in the game
  const resolved = await Promise.all(
    urls.map(async (raw) => {
      const expanded = needsExpansion(raw) ? await expandUrl(raw) : raw;
      const parsed = parseVideoUrl(expanded) || parseVideoUrl(raw);
      const playable = parsed ? await checkPlayable(parsed) : "unknown";
      return { raw, parsed, playable };
    })
  );
  for (const { raw, parsed, playable } of resolved) {
    if (!parsed) {
      results.push({
        url: raw,
        status: "invalid",
        message: needsExpansion(raw)
          ? "We couldn't open that share link. Open the video in your browser, copy the address from the address bar and paste that instead"
          : undefined,
      });
      continue;
    }
    if (playable === "restricted" || playable === "gone") {
      results.push({ url: raw, status: "unplayable", message: playabilityMessage(playable, parsed.platform) });
      continue;
    }
    if (room <= 0) {
      results.push({ url: raw, status: "full" });
      continue;
    }
    const { error } = await db.from("videos").insert({
      group_id: g.id,
      submitted_by: player.id,
      platform: parsed.platform,
      source_url: parsed.sourceUrl,
      embed_url: parsed.embedUrl,
    });
    if (error) {
      results.push({ url: raw, status: error.code === "23505" ? "duplicate" : "invalid" });
    } else {
      room--;
      results.push({ url: raw, status: "added" });
    }
  }
  return json({ results, added: results.filter((r) => r.status === "added").length });
});
