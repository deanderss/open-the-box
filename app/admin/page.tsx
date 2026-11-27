import { redirect } from "next/navigation";
import TopBar from "@/components/TopBar";
import { getMe } from "@/lib/me";
import { supabaseAdmin } from "@/lib/supabase-server";
import AdminPanel from "./AdminPanel";
import { DEFAULTS } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { mod } = await getMe();
  if (!mod.is_admin) redirect("/groups");
  const db = supabaseAdmin();
  const [{ data: mods }, { data: settings }, { data: owned }, { data: reqs }] = await Promise.all([
    db.from("moderators").select("id,display_name,email,is_admin,suspended,created_at").eq("approved", true).order("created_at"),
    db.from("app_settings").select("max_moderators").eq("id", 1).single(),
    db.from("groups").select("owner_id"),
    db.from("moderator_requests").select("id,email,display_name,status,ip,user_agent,created_at,decided_at").order("created_at", { ascending: false }).limit(100),
  ]);
  const counts = new Map<string, number>();
  (owned || []).forEach((g) => g.owner_id && counts.set(g.owner_id, (counts.get(g.owner_id) || 0) + 1));
  return (
    <>
      <TopBar name={mod.display_name} isAdmin back={{ href: "/groups", label: "All boxes" }} />
      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <h1 className="title mt-2 text-4xl text-sunny">🛠 Moderators</h1>
        <p className="mt-1 text-white/70">Approve new moderators and manage seats. Pending requests hold a seat until you decide.</p>
        <AdminPanel
          meId={mod.id}
          cap={settings?.max_moderators ?? DEFAULTS.max_moderators}
          mods={(mods || []).map((m) => ({ id: m.id, name: m.display_name, email: m.email, isAdmin: m.is_admin, suspended: !!m.suspended, createdAt: m.created_at, boxes: counts.get(m.id) || 0 }))}
          requests={(reqs || []).map((r) => ({ id: r.id, name: r.display_name, email: r.email, status: r.status as "pending" | "approved" | "denied", ip: r.ip, userAgent: r.user_agent, createdAt: r.created_at, decidedAt: r.decided_at }))}
        />
      </main>
    </>
  );
}
