import Link from "next/link";
import TopBar from "@/components/TopBar";
import CreateGroup from "./CreateGroup";
import { getMe } from "@/lib/me";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const { sb, mod } = await getMe();
  const { data: groups } = await sb.from("groups").select("id,name,color,emoji,owner_id,created_at").order("created_at");
  // One "how many in the box" count per group card — this used to download a full group_id-per-row list of
  // every queued video across every group on the whole site just to tally it in JS. A `head: true` count
  // query returns nothing but a number in its response header, and running one per group in parallel costs
  // about the same as the single bloated query did, without the per-row payload or the cross-tenant scan.
  const counts = new Map<string, number>(
    await Promise.all(
      (groups || []).map(async (g) => {
        const { count } = await sb.from("videos").select("id", { count: "exact", head: true }).eq("group_id", g.id).eq("status", "queued");
        return [g.id as string, count ?? 0] as const;
      })
    )
  );

  return (
    <>
      <TopBar name={mod.display_name} isAdmin={mod.is_admin} />
      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="mb-8 mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="title text-4xl sm:text-5xl">Pick your box</h1>
            <p className="mt-2 text-white/70">Which group are you playing with today?</p>
          </div>
          <CreateGroup />
        </div>
        {(!groups || groups.length === 0) && (
          <div className="card text-center">
            <p className="text-5xl">📦</p>
            <p className="mt-3 font-display text-2xl">No boxes yet!</p>
            <p className="mt-1 text-white/70">Create your first group to get started.</p>
          </div>
        )}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {(groups || []).map((g) => (
            <Link key={g.id} href={`/g/${g.id}`} className="group card relative overflow-hidden transition hover:-translate-y-1 hover:rotate-[-1deg]" style={{ borderColor: g.color }}>
              <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full opacity-30" style={{ background: g.color }} />
              <div className="text-6xl transition group-hover:scale-110">{g.emoji}</div>
              <h2 className="title mt-3 text-2xl">{g.name}</h2>
              <div className="mt-3 flex items-center gap-2 text-sm text-white/70">
                <span className="rounded-full bg-sunny px-3 py-1 font-bold text-night">{counts.get(g.id) || 0} in the box</span>
                {g.owner_id !== mod.id && <span className="rounded-full bg-white/10 px-3 py-1">co-moderator</span>}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
