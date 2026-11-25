import { handle, body, HttpError } from "@/lib/api";
import { json } from "@/lib/util";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { BUCKET, MAX_TOTAL_UPLOAD_BYTES, MAX_UPLOAD_BYTES, MAX_UPLOADS_PER_BOX, VIDEO_TYPES, extensionFor, requireSubmitter, requireUploadsEnabled, storedUploadBytes } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** Step 1: validate the file the phone wants to upload and hand back a one-time signed upload URL. */
export const POST = handle(async (req) => {
  requireUploadsEnabled();
  if (!rateLimit("upstart:" + clientIp(req), 40, 60 * 60 * 1000)) throw new HttpError(429, "That's a lot of uploads! Try again in a bit.");
  const { token, playerId, filename, contentType, size } = await body<{ token?: string; playerId?: string; filename?: string; contentType?: string; size?: number }>(req);
  const { db, group } = await requireSubmitter(token, playerId);

  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) throw new HttpError(400, "That file looks empty");
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `That video is ${(bytes / 1048576).toFixed(0)} MB. The limit is ${MAX_UPLOAD_BYTES / 1048576} MB, so trim it or pick a shorter clip.`);
  }
  const ext = extensionFor(filename || "", contentType || "");
  if (!ext) throw new HttpError(400, "That doesn't look like a video we can play (try an MP4 or MOV)");

  const { data: settings } = await db.from("app_settings").select("max_queued_videos_per_group").eq("id", 1).single();
  const { count: queued } = await db.from("videos").select("*", { count: "exact", head: true }).eq("group_id", group.id).eq("status", "queued");
  if ((queued ?? 0) >= (settings?.max_queued_videos_per_group ?? 300)) throw new HttpError(409, "The box is stuffed full");
  const { count: uploads } = await db.from("videos").select("*", { count: "exact", head: true }).eq("group_id", group.id).eq("platform", "upload").not("storage_path", "is", null);
  if ((uploads ?? 0) >= MAX_UPLOADS_PER_BOX) throw new HttpError(409, "This box already holds a lot of uploaded videos. Wait until some have been played.");

  if ((await storedUploadBytes()) + bytes > MAX_TOTAL_UPLOAD_BYTES) {
    throw new HttpError(409, "The box's video storage is full right now. Try again after some videos have been played, or paste a link instead.");
  }

  const path = `${group.id}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new HttpError(500, "Couldn't start the upload. Try again.");
  return json({ path, signedUrl: data.signedUrl, contentType: VIDEO_TYPES[ext] });
});
