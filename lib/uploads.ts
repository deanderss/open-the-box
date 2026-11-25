import { supabaseAdmin } from "./supabase-server";
import { HttpError } from "./api";

/**
 * Personal videos uploaded from a phone's camera roll.
 * Files go straight from the phone to Supabase Storage through a one-time signed upload URL (so they never pass
 * through our server and Vercel's request-size limit is irrelevant). Names are random, so a file's URL says nothing
 * about who sent it. Files are deleted once the video has been played and rated (see purgeUpload).
 */

export const BUCKET = "box-videos";
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // the free Supabase plan's per-file limit
export const MAX_UPLOADS_PER_BOX = 40; // keeps a box well inside the 1 GB free storage quota
export const MAX_FILES_PER_SUBMIT = 5;

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
