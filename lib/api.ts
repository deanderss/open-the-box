import { currentUserId, isGroupMod, isAdmin } from "./supabase-server";
import { json } from "./util";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser() {
  const uid = await currentUserId();
  if (!uid) throw new HttpError(401, "Please log in");
  return uid;
}

export async function requireGroupMod(groupId: string) {
  const uid = await requireUser();
  const role = await isGroupMod(uid, groupId);
  if (!role) throw new HttpError(403, "You are not a moderator of this box");
  return { uid, role };
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
