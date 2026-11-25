import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase-server";

export async function getMe() {
  const sb = supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: mod } = await sb.from("moderators").select("id,display_name,email,is_admin,suspended").eq("id", data.user.id).maybeSingle();
  if (mod?.suspended) redirect("/suspended");
  return { sb, user: data.user, mod: mod ?? { id: data.user.id, display_name: data.user.email ?? "Moderator", email: data.user.email ?? "", is_admin: false } };
}
