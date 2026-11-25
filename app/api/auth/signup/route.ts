import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError } from "@/lib/api";
import { json } from "@/lib/util";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const POST = handle(async (req) => {
  if (!rateLimit("signup:" + clientIp(req), 5, 60 * 60 * 1000)) throw new HttpError(429, "Too many attempts, try later");
  const { name, email, password } = await body<{ name?: string; email?: string; password?: string }>(req);
  const n = (name || "").trim().slice(0, 40);
  const e = (email || "").trim().toLowerCase();
  if (!n || !/^\S+@\S+\.\S+$/.test(e)) throw new HttpError(400, "Enter your name and a valid email");
  if (!password || password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
  const admin = supabaseAdmin();
  const { data: slots } = await admin.rpc("moderator_slots_remaining");
  if (!slots || (slots as number) <= 0) throw new HttpError(403, "box_full");
  const { error } = await admin.auth.admin.createUser({
    email: e,
    password,
    email_confirm: true,
    user_metadata: { display_name: n },
  });
  if (error) {
    const msg = error.message || "";
    if (/cap_reached|Database error/i.test(msg)) throw new HttpError(403, "box_full");
    if (/already|registered|exists/i.test(msg)) throw new HttpError(409, "That email already has an account — try logging in");
    throw new HttpError(400, msg);
  }
  return json({ ok: true });
});
