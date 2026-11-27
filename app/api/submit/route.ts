import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError } from "@/lib/api";
import { json } from "@/lib/util";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { extractUrls, parseVideoUrl, needsExpansion, expandUrl } from "@/lib/embeds";
import { checkMedia } from "@/lib/playable";
import { groupByToken, loadSubmitPage } from "@/lib/submitLookup";
import { getSettings } from "@/lib/settings";
import { SITE } from "@/lib/sites";

export const dynamic = "force-dynamic";

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

  const settings = await getSettings();
  const { count: queued } = await db.from("videos").select("id", { count: "exact", head: true }).eq("group_id", g.id).eq("status", "queued");
  const room = settings.max_queued_videos_per_group - (queued ?? 0);

  // Resolve every link first (share links need a fetch to find the real video).
  const resolved = await Promise.all(
    urls.map(async (raw) => {
      const expanded = needsExpansion(raw) ? await expandUrl(raw) : raw;
      const parsed = parseVideoUrl(expanded) || parseVideoUrl(raw);
      return { raw, parsed };
    })
  );

  // A duplicate can be one already sitting in the box, or the same link pasted twice in this one paste — check
  // both with a single lookup instead of finding out one row at a time. Everything after that is figured out
  // up front (room, duplicate, invalid) so the only write below is one bulk insert for whatever's actually new,
  // instead of up to 15 sequential single-row inserts for one submission.
  const candidateUrls = Array.from(new Set(resolved.flatMap((r) => (r.parsed ? [r.parsed.sourceUrl] : []))));
  const { data: existing } = candidateUrls.length ? await db.from("videos").select("source_url").eq("group_id", g.id).in("source_url", candidateUrls) : { data: [] };
  const existingSet = new Set((existing || []).map((r) => r.source_url as string));

  type Parsed = NonNullable<(typeof resolved)[number]["parsed"]>;
  type Media = Awaited<ReturnType<typeof checkMedia>> | null;
  const outcomes: { raw: string; parsed: Parsed | null; media: Media; status: "added" | "duplicate" | "invalid" | "full" }[] = [];
  const seenInBatch = new Set<string>();
  let slotsLeft = room;
  for (const { raw, parsed } of resolved) {
    if (!parsed) {
      outcomes.push({ raw, parsed, media: null, status: "invalid" });
    } else if (existingSet.has(parsed.sourceUrl) || seenInBatch.has(parsed.sourceUrl)) {
      outcomes.push({ raw, parsed, media: null, status: "duplicate" });
    } else if (slotsLeft <= 0) {
      outcomes.push({ raw, parsed, media: null, status: "full" });
    } else {
      seenInBatch.add(parsed.sourceUrl);
      slotsLeft--;
      outcomes.push({ raw, parsed, media: null, status: "added" });
    }
  }
  // Only the videos actually going in the box get the platform check (in parallel), which decides the heads-up
  // note and the saved playability. Duplicates and overflow are no longer checked for nothing. Every link in a
  // supported format is accepted either way, because the host can open the awkward ones in the app.
  await Promise.all(
    outcomes.map(async (o) => {
      if (o.status === "added" && o.parsed) o.media = await checkMedia(o.parsed);
    })
  );
  const toInsert = outcomes.flatMap((o) => (o.status === "added" && o.parsed ? [{ parsed: o.parsed, media: o.media }] : []));

  if (toInsert.length) {
    // `ignoreDuplicates` (ON CONFLICT ... DO NOTHING) is a safety net for the rare race where another request
    // adds the same link between the lookup above and this write — RETURNING only ever reports rows a DO
    // NOTHING statement actually touched, so anything missing from it lost that race and gets relabeled below
    // instead of being reported as added.
    const { data: inserted, error } = await db
      .from("videos")
      .upsert(
        toInsert.map(({ parsed, media }) => ({
          group_id: g.id,
          submitted_by: player.id,
          platform: parsed.platform,
          source_url: parsed.sourceUrl,
          embed_url: parsed.embedUrl,
          // Saved now so the host screen can show the restricted/gone flag and the Instagram crop aspect
          // without re-checking the platform live on every poll during the game.
          playability: media?.playability ?? null,
          aspect: media?.aspect ?? null,
        })),
        { onConflict: "group_id,source_url", ignoreDuplicates: true }
      )
      .select("source_url");
    if (error) throw new HttpError(503, "The game service is having trouble — try again in a moment");
    const insertedSet = new Set((inserted || []).map((r) => r.source_url as string));
    outcomes.forEach((o) => {
      if (o.status === "added" && o.parsed && !insertedSet.has(o.parsed.sourceUrl)) o.status = "duplicate";
    });
  }

  const results = outcomes.map(({ raw, parsed, media, status }) => {
    if (status === "invalid") {
      return {
        url: raw,
        status,
        message: needsExpansion(raw)
          ? "We couldn't open that share link. Open the video in your browser, copy the address from the address bar and paste that instead"
          : undefined,
      };
    }
    if (status !== "added" || !parsed) return { url: raw, status };
    const playable = media?.playability ?? "unknown";
    return {
      url: raw,
      status,
      message:
        playable === "restricted"
          ? `Added! Heads up: ${SITE[parsed.platform] ?? "The site"} only plays this one in its own app, so the host will open it there`
          : playable === "gone"
            ? `Added! Heads up: ${SITE[parsed.platform] ?? "The site"} says this one may be removed or private, so the host will check it in the app`
            : undefined,
    };
  });
  return json({ results, added: results.filter((r) => r.status === "added").length });
});
