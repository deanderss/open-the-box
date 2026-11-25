import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient, SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export function supabaseServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(list) {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            /* called from a server component — middleware refreshes sessions */
          }
        },
      },
    }
  );
}

let _admin: SupabaseClient | null = null;
export function supabaseAdmin() {
  if (!_admin) {
    _admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

/** Returns the logged-in moderator's user id, or null. */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabaseServer().auth.getUser();
  return data.user?.id ?? null;
}

export async function isGroupMod(userId: string, groupId: string) {
  const { data } = await supabaseAdmin()
    .from("group_moderators")
    .select("role")
    .eq("group_id", groupId)
    .eq("moderator_id", userId)
    .maybeSingle();
  return data?.role as "owner" | "co" | undefined;
}

export async function isAdmin(userId: string) {
  const { data } = await supabaseAdmin().from("moderators").select("is_admin").eq("id", userId).maybeSingle();
  return !!data?.is_admin;
}
