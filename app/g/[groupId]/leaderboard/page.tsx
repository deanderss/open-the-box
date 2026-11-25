import Link from "next/link";
import { notFound } from "next/navigation";
import TopBar from "@/components/TopBar";
import Avatar from "@/components/Avatar";
import { getMe } from "@/lib/me";

export const dynamic = "force-dynamic";

type Row = { id: string; name: string; color: string; correct: number; guesses: number };

export default async function LeaderboardPage({ params, searchParams }: { params: { groupId: string }; searchParams: { view?: string } }) {
  const { sb, mod } = await getMe();
  const { data: group } = await sb.from("groups").select("id,name,emoji").eq("id", params.groupId).maybeSingle();
  if (!group) notFound();
  const view = searchParams.view === "last" ? "last" : "all";

  const { data: players } = await sb.from("players").select("id,display_name,avatar_color,active").eq("group_id", group.id);
  const pm = new Map((players || []).map((p) => [p.id, p]));
  let rows: Row[] = [];
  let lastLabel = "";

  if (view === "all") {
    const { data } = await sb.from("group_leaderboard").select("*").eq("group_id", group.id);
    rows = (data || [])
      .filter((r) => r.guesses > 0 || pm.get(r.player_id)?.active)
      .map((r) => ({ id: r.player_id, name: r.display_name, color: r.avatar_color, correct: Number(r.correct), guesses: Number(r.guesses) }));
  } else {
    const { data: last } = await sb.from("sessions").select("id,created_at").eq("group_id", group.id).neq("state", "lobby").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last) {
      lastLabel = new Date(last.created_at).toLocaleDateString();
      const { data: resps } = await sb.from("responses").select("player_id,is_correct").eq("session_id", last.id).eq("is_decoy", false);
      const agg = new Map<string, Row>();
      (resps || []).forEach((r) => {
        const p = pm.get(r.player_id);
        const row = agg.get(r.player_id) || { id: r.player_id, name: p?.display_name ?? "?", color: p?.avatar_color ?? "#999", correct: 0, guesses: 0 };
        row.guesses++;
        if (r.is_correct) row.correct++;
        agg.set(r.player_id, row);
      });
      rows = Array.from(agg.values());
    }
  }
  rows.sort((a, b) => b.correct - a.correct || b.correct / (b.guesses || 1) - a.correct / (a.guesses || 1));

  return (
    <>
      <TopBar name={mod.display_name} isAdmin={mod.is_admin} back={{ href: `/g/${group.id}`, label: group.name }} />
      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <h1 className="title mt-2 text-4xl text-mint sm:text-5xl">🕵️ Leaderboard</h1>
        <p className="mt-1 text-white/70">
          {group.emoji} {group.name}: who&apos;s best at guessing the sender?
        </p>
        <div className="mt-4 inline-flex rounded-2xl bg-black/30 p-1">
          <Link href="?view=all" className={`rounded-xl px-4 py-2 font-display ${view === "all" ? "bg-mint text-night" : "text-white/70"}`}>
            All time
          </Link>
          <Link href="?view=last" className={`rounded-xl px-4 py-2 font-display ${view === "last" ? "bg-mint text-night" : "text-white/70"}`}>
            Last session {lastLabel && `(${lastLabel})`}
          </Link>
        </div>
        <div className="card mt-6 p-0">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm uppercase tracking-widest text-white/50">
                <th className="p-4">#</th>
                <th className="p-4">Player</th>
                <th className="p-4 text-right">Correct</th>
                <th className="hidden p-4 text-right sm:table-cell">Guesses</th>
                <th className="p-4 text-right">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-t border-white/10">
                  <td className="p-4 font-display text-2xl">{["🥇", "🥈", "🥉"][i] || i + 1}</td>
                  <td className="p-4">
                    <span className="flex items-center gap-3">
                      <Avatar name={r.name} color={r.color} size={36} /> <span className="font-semibold">{r.name}</span>
                    </span>
                  </td>
                  <td className="p-4 text-right font-display text-2xl text-sunny">{r.correct}</td>
                  <td className="hidden p-4 text-right text-white/70 sm:table-cell">{r.guesses}</td>
                  <td className="p-4 text-right text-white/70">{r.guesses ? Math.round((r.correct / r.guesses) * 100) : 0}%</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-white/60">
                    No guesses yet. Open the box to start the competition!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
