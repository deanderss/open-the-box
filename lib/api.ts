import { currentUserId, isGroupMod, isAdmin, isSuspended, supabaseAdmin } from "./supabase-server";
import { json } from "./util";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Throw a friendly error (and log the real one) when a database write failed, instead of reporting success. */
export function check<T extends { error: unknown }>(res: T, message = "Couldn't save that. Please try again."): T {
  if (res.error) {
    console.error(message, res.error);
    throw new HttpError(503, message);
  }
  return res;
}

export async function requireUser() {
  const uid = await currentUserId();
  if (!uid) throw new HttpError(401, "Please log in");
  // A suspended moderator's existing login stays valid for up to an hour, so check every time
  if (await isSuspended(uid)) throw new HttpError(403, "This account has been suspended");
  return uid;
}

export async function requireGroupMod(groupId: string) {
  const uid = await currentUserId();
  if (!uid) throw new HttpError(401, "Please log in");
  // Both only depend on the uid we already have, not on each other — this is on the host's hot path (every
  // Next/Reveal/Skip tap), so there's no reason to pay for two sequential database round trips here.
  // One moderators read gives both the suspension check and whether this is the admin account.
  const [{ data: mod }, role] = await Promise.all([
    supabaseAdmin().from("moderators").select("suspended,is_admin").eq("id", uid).maybeSingle(),
    isGroupMod(uid, groupId),
  ]);
  if (mod?.suspended) throw new HttpError(403, "This account has been suspended");
  if (!role) throw new HttpError(403, "You are not a moderator of this box");
  return { uid, role, admin: !!mod?.is_admin };
}

export async function requireAdmin() {
  const uid = await requireUser();
  if (!(await isAdmin(uid))) throw new HttpError(403, "Admins only");
  return uid;
}

export function handle(fn: (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Record<string, string> }) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong" }, 500);
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
