import { redirect } from "next/navigation";
import TopBar from "@/components/TopBar";
import { getMe } from "@/lib/me";
import { supabaseAdmin } from "@/lib/supabase-server";
import AdminPanel from "./AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { mod } = await getMe();
  if (!mod.is_admin) redirect("/groups");
  const db = supabaseAdmin();
  const [{ data: mods }, { data: settings }, { data: owned }] = await Promise.all([
    db.from("moderators").select("id,display_name,email,is_admin,created_at").order("created_at"),
    db.from("app_settings").select("max_moderators").eq("id", 1).single(),
    db.from("groups").select("owner_id"),
  ]);
  const counts = new Map<string, number>();
  (owned || []).forEach((g) => g.owner_id && counts.set(g.owner_id, (counts.get(g.owner_id) || 0) + 1));
  return (
    <>
      <TopBar name={mod.display_name} isAdmin back={{ href: "/groups", label: "All boxes" }} />
      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <h1 className="title mt-2 text-4xl text-sunny">🛠 Moderator seats</h1>
        <p className="mt-1 text-white/70">Keep things small and free. Sign-up locks when every seat is taken.</p>
        <AdminPanel
          meId={mod.id}
          cap={settings?.max_moderators ?? 10}
          mods={(mods || []).map((m) => ({ id: m.id, name: m.display_name, email: m.email, isAdmin: m.is_admin, createdAt: m.created_at, boxes: counts.get(m.id) || 0 }))}
        />
      </main>
    </>
  );
}
