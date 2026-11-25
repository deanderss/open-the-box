import { handle, body, HttpError } from "@/lib/api";
import { json } from "@/lib/util";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { BUCKET, MAX_UPLOAD_BYTES, UPLOAD_PATH_RE, publicUrl, requireSubmitter } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** Step 2: the phone says the upload finished. Check the file really is in storage, then put it in the box. */
export const POST = handle(async (req) => {
  if (!rateLimit("upfinish:" + clientIp(req), 60, 60 * 60 * 1000)) throw new HttpError(429, "Slow down!");
  const { token, playerId, path } = await body<{ token?: string; playerId?: string; path?: string }>(req);
  const { db, group, player } = await requireSubmitter(token, playerId);
  if (!path || !UPLOAD_PATH_RE(group.id).test(path)) throw new HttpError(400, "Unknown upload");

  const name = path.split("/")[1];
  const { data: objs } = await db.storage.from(BUCKET).list(group.id, { search: name, limit: 5 });
  const obj = objs?.find((o) => o.name === name);
  const size = Number((obj?.metadata as { size?: number } | undefined)?.size ?? 0);
  const mime = String((obj?.metadata as { mimetype?: string } | undefined)?.mimetype ?? "");
  if (!obj || size <= 0) throw new HttpError(400, "The upload didn't finish. Try again.");
  if (size > MAX_UPLOAD_BYTES || !mime.startsWith("video/")) {
    await db.storage.from(BUCKET).remove([path]);
    throw new HttpError(400, "That file isn't a video we can play");
  }

  const { data: settings } = await db.from("app_settings").select("max_queued_videos_per_group").eq("id", 1).single();
  const { count: queued } = await db.from("videos").select("*", { count: "exact", head: true }).eq("group_id", group.id).eq("status", "queued");
  if ((queued ?? 0) >= (settings?.max_queued_videos_per_group ?? 300)) {
    await db.storage.from(BUCKET).remove([path]);
    return json({ status: "full" });
  }

  const url = publicUrl(path);
  const { error } = await db.from("videos").insert({
    group_id: group.id,
    submitted_by: player.id,
    platform: "upload",
    source_url: url,
    embed_url: url,
    storage_path: path,
  });
  if (error) {
    if (error.code === "23505") return json({ status: "duplicate" });
    await db.storage.from(BUCKET).remove([path]);
    throw new HttpError(400, "Couldn't add that video");
  }
  return json({ status: "added" });
});
