import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase-server";

export async function getMe() {
  const sb = supabaseServer();
  // getClaims() verifies the JWT locally against the project's (cached) signing keys instead of getUser()'s
  // round trip to the Auth server on every single page load — same guarantee (a validly-signed, unexpired
  // token), it just doesn't have to leave the server to check it whenever this project's signing keys
  // support local verification (transparently falls back to the getUser()-style network check otherwise).
  const { data } = await sb.auth.getClaims();
  if (!data?.claims) redirect("/login");
  const uid = data.claims.sub as string;
  const email = (data.claims.email as string | undefined) ?? "";
  const { data: mod } = await sb.from("moderators").select("id,display_name,email,is_admin,suspended").eq("id", uid).maybeSingle();
  if (mod?.suspended) redirect("/suspended");
  return { sb, uid, mod: mod ?? { id: uid, display_name: email || "Moderator", email, is_admin: false } };
}
