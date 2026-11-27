import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError } from "@/lib/api";
import { json } from "@/lib/util";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { extractUrls, parseVideoUrl, needsExpansion, expandUrl } from "@/lib/embeds";
import { checkMedia } from "@/lib/playable";
import { groupByToken, loadSubmitPage } from "@/lib/submitLookup";

export const dynamic = "force-dynamic";

function siteName(platform: string) {
  return platform === "instagram" ? "Instagram" : platform === "youtube" ? "YouTube" : platform === "tiktok" ? "TikTok" : "Facebook";
}

// The page itself now loads this server-side on first visit — this GET is kept only for the client's own
// "something went wrong, try again" retry button, which has no other way to re-ask.
export const GET = handle(async (req) => {
  if (!rateLimit("submitget:" + clientIp(req), 120, 60 * 60 * 1000)) throw new HttpError(429, "Slow down!");
  const data = await loadSubmitPage(new URL(req.url).searchParams.get("token"));
  return json(data);
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

  const results: { url: string; status: "added" | "duplicate" | "invalid" | "full"; message?: string }[] = [];
  // Resolve every link first, then ask the platforms (in parallel) whether each video can play inside the game.
  // That only decides the heads-up note: every link in a supported format is accepted either way, because the host
  // can open the awkward ones in the app during the game.
  const resolved = await Promise.all(
    urls.map(async (raw) => {
      const expanded = needsExpansion(raw) ? await expandUrl(raw) : raw;
      const parsed = parseVideoUrl(expanded) || parseVideoUrl(raw);
      const media = parsed ? await checkMedia(parsed) : null;
      return { raw, parsed, media };
    })
  );
  for (const { raw, parsed, media } of resolved) {
    const playable = media?.playability ?? "unknown";
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
      // Saved now so the host screen can show the restricted/gone flag and the Instagram crop aspect
      // without re-checking the platform live on every poll during the game.
      playability: media?.playability ?? null,
      aspect: media?.aspect ?? null,
    });
    if (error) {
      results.push({ url: raw, status: error.code === "23505" ? "duplicate" : "invalid" });
    } else {
      room--;
      results.push({
        url: raw,
        status: "added",
        message:
          playable === "restricted"
            ? `Added! Heads up: ${siteName(parsed.platform)} only plays this one in its own app, so the host will open it there`
            : playable === "gone"
              ? `Added! Heads up: ${siteName(parsed.platform)} says this one may be removed or private, so the host will check it in the app`
              : undefined,
      });
    }
  }
  return json({ results, added: results.filter((r) => r.status === "added").length });
});
