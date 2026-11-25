import { supabaseAdmin } from "@/lib/supabase-server";
import { handle, body, HttpError } from "@/lib/api";
import { json } from "@/lib/util";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { ADMIN_EMAIL, sendApprovalRequestEmail } from "@/lib/notify";

// ~100 years: effectively "blocked until approved" (lifted on approval).
const BLOCKED = "876000h";

export const POST = handle(async (req) => {
  const ip = clientIp(req);
  if (!rateLimit("signup:" + ip, 5, 60 * 60 * 1000)) throw new HttpError(429, "Too many attempts, try later");
  const { name, email, password } = await body<{ name?: string; email?: string; password?: string }>(req);
  const n = (name || "").trim().slice(0, 40);
  const e = (email || "").trim().toLowerCase();
  if (!n || !/^\S+@\S+\.\S+$/.test(e)) throw new HttpError(400, "Enter your name and a valid email");
  if (!password || password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
  const admin = supabaseAdmin();
  const { data: slots } = await admin.rpc("moderator_slots_remaining");
  if (!slots || (slots as number) <= 0) throw new HttpError(403, "box_full");

  // The admin's own account is never gated; everyone else waits for approval.
  const isAdminAccount = e === ADMIN_EMAIL;
  const { data: created, error } = await admin.auth.admin.createUser({
    email: e,
    password,
    email_confirm: true,
    user_metadata: { display_name: n },
    ...(isAdminAccount ? {} : { ban_duration: BLOCKED }),
  });
  if (error || !created?.user) {
    const msg = error?.message || "";
    if (/cap_reached|Database error/i.test(msg)) throw new HttpError(403, "box_full");
    if (/already|registered|exists/i.test(msg)) throw new HttpError(409, "That email already has an account — try logging in");
    throw new HttpError(400, msg || "Sign up failed");
  }
  if (isAdminAccount) return json({ ok: true, pending: false });

  const userAgent = req.headers.get("user-agent") || "unknown";
  const { error: reqErr } = await admin.from("moderator_requests").insert({
    user_id: created.user.id,
    email: e,
    display_name: n,
    ip,
    user_agent: userAgent.slice(0, 300),
  });
  if (reqErr) {
    // Don't leave an account that nobody can see or approve.
    await admin.auth.admin.deleteUser(created.user.id);
    console.error("could not record moderator request", reqErr);
    throw new HttpError(500, "Could not send your request, please try again");
  }

  await sendApprovalRequestEmail({ name: n, email: e, ip, userAgent, origin: new URL(req.url).origin });
  return json({ ok: true, pending: true });
});
