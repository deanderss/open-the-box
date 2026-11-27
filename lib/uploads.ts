import { supabaseAdmin } from "./supabase-server";
import { HttpError } from "./api";

/**
 * Personal videos uploaded from a phone's camera roll.
 * Files go straight from the phone to Supabase Storage through a one-time signed upload URL (so they never pass
 * through our server and Vercel's request-size limit is irrelevant). Names are random, so a file's URL says nothing
 * about who sent it. Files are deleted once the video has been played and rated (see purgeUpload).
 */

export const BUCKET = "box-videos";
// The free Supabase plan's actual per-file limit is 50 MB, but a phone-recorded clip long enough to need
// anywhere near that is already well past how long a round of this game should take to watch and guess on —
// halving it to 25 MB costs nothing a real clip needs and halves the worst-case storage/egress per upload on
// a plan where both are the tightest constraint.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOADS_PER_BOX = 40; // keeps a box well inside the 1 GB free storage quota
export const MAX_FILES_PER_SUBMIT = 5;
/** Project-wide ceiling for files waiting to be played. The free plan's quota is 1 GB; stay clear of it. */
export const MAX_TOTAL_UPLOAD_BYTES = 800 * 1024 * 1024;

/**
 * Personal-video uploads are built but switched OFF by default. Turn them on by setting the environment variable
 * UPLOADS_ENABLED=true (Vercel project settings) and redeploying. Read on the server only; the submit page asks
 * /api/submit whether to show the upload card.
 */
export function uploadsEnabled() {
  return process.env.UPLOADS_ENABLED === "true";
}

export function requireUploadsEnabled() {
  if (!uploadsEnabled()) throw new HttpError(403, "Video uploads aren't turned on yet");
}

/** Bytes currently stored for uploaded videos that haven't been played (and deleted) yet. */
export async function storedUploadBytes() {
  const { data } = await supabaseAdmin().from("videos").select("file_bytes").eq("platform", "upload").not("storage_path", "is", null);
  return (data || []).reduce((sum, r) => sum + Number(r.file_bytes || 0), 0);
}

/** extension -> mime type (what iPhones, Androids and browsers produce) */
export const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
};

/** Pick a storage extension for an uploaded file from its name, falling back to its mime type. */
export function extensionFor(filename: string, contentType: string): string | null {
  const fromName = filename.toLowerCase().match(/\.([a-z0-9]{2,4})$/)?.[1];
  if (fromName && VIDEO_TYPES[fromName]) return fromName;
  const t = contentType.toLowerCase();
  const hit = Object.entries(VIDEO_TYPES).find(([, mime]) => mime === t);
  return hit ? hit[0] : null;
}

export const UPLOAD_PATH_RE = (groupId: string) => new RegExp(`^${groupId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(mp4|m4v|mov|webm|3gp)$`);

export function publicUrl(path: string) {
  return supabaseAdmin().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Same check as the link form: a secret box link plus a player on that box's roster. */
export async function requireSubmitter(token: string | undefined | null, playerId: string | undefined | null) {
  if (!token || token.length < 16) throw new HttpError(404, "This link is invalid or has been replaced");
  const db = supabaseAdmin();
  const { data: group } = await db.from("groups").select("id").eq("submit_token", token).maybeSingle();
  if (!group) throw new HttpError(404, "This link is invalid or has been replaced");
  const { data: player } = await db.from("players").select("id").eq("id", playerId || "").eq("group_id", group.id).eq("active", true).maybeSingle();
  if (!player) throw new HttpError(400, "Pick your name first");
  return { db, group, player };
}

/** Delete an uploaded video's file once it has been played and rated (or skipped). Keeps the row for the scores. */
export async function purgeUpload(videoId: string | null | undefined) {
  if (!videoId) return;
  try {
    const db = supabaseAdmin();
    const { data: v } = await db.from("videos").select("platform,storage_path").eq("id", videoId).maybeSingle();
    if (!v || v.platform !== "upload" || !v.storage_path) return;
    await db.storage.from(BUCKET).remove([v.storage_path as string]);
    await db.from("videos").update({ storage_path: null }).eq("id", videoId);
  } catch {
    /* best effort: the box-deletion cleanup will catch any leftovers */
  }
}

/**
 * Daily cleanup (called from the keepalive cron): delete any file sitting in storage that no `videos` row
 * points at any more — a half-finished upload where the phone never called `/api/upload/finish` (tab closed
 * mid-submit, a dropped connection), or `/api/upload/start`'s own abandoned-upload sweep missing one. Storage's
 * `list()` only looks one folder level deep, so this walks it one group at a time (the exact layout every
 * upload already uses: `{groupId}/{uuid}.ext`) rather than attempting a bucket-wide listing.
 */
export async function sweepOrphanedUploads() {
  const db = supabaseAdmin();
  // One listing of the bucket's top level gives the boxes that actually have files (one folder per box), instead
  // of listing every box. A folder left behind by a deleted box has no rows, so its files are swept too.
  const { data: folders } = await db.storage.from(BUCKET).list("", { limit: 1000 });
  let removed = 0;
  for (const f of folders || []) {
    if (f.id) continue; // a loose file at the top level, not a box folder
    const gid = f.name;
    try {
      const { data: objs } = await db.storage.from(BUCKET).list(gid, { limit: 1000 });
      if (!objs || objs.length === 0) continue;
      const { data: rows } = await db.from("videos").select("storage_path").eq("group_id", gid).not("storage_path", "is", null);
      const kept = new Set((rows || []).map((r) => r.storage_path as string));
      // An hour-old safety margin: a file can legitimately sit in storage with no `videos` row for the few
      // seconds between the upload finishing and `/api/upload/finish` inserting the row — this cron only
      // ever runs about once a day, but there's no reason to risk racing a submission that's still in flight.
      const hourAgo = Date.now() - 60 * 60 * 1000;
      const orphans = objs
        .filter((o) => !o.created_at || new Date(o.created_at).getTime() < hourAgo)
        .map((o) => `${gid}/${o.name}`)
        .filter((path) => !kept.has(path));
      if (orphans.length) {
        await db.storage.from(BUCKET).remove(orphans);
        removed += orphans.length;
      }
    } catch {
      /* best effort: move on to the next group rather than letting one bad listing stop the whole sweep */
    }
  }
  return removed;
}

/** Remove every uploaded file of these boxes (call before deleting the boxes). Also sweeps abandoned half-uploads. */
export async function purgeGroupUploads(groupIds: string[]) {
  const db = supabaseAdmin();
  for (const gid of groupIds) {
    try {
      for (let guard = 0; guard < 20; guard++) {
        const { data: objs } = await db.storage.from(BUCKET).list(gid, { limit: 100 });
        if (!objs || objs.length === 0) break;
        await db.storage.from(BUCKET).remove(objs.map((o) => `${gid}/${o.name}`));
        if (objs.length < 100) break;
      }
    } catch {
      /* best effort */
    }
  }
}
