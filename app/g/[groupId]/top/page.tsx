import { notFound } from "next/navigation";
import TopBar from "@/components/TopBar";
import { getMe } from "@/lib/me";
import TopList from "./TopList";

export const dynamic = "force-dynamic";

export default async function TopPage({ params }: { params: { groupId: string } }) {
  const { sb, mod } = await getMe();
  const { data: group } = await sb.from("groups").select("id,name,emoji,color").eq("id", params.groupId).maybeSingle();
  if (!group) notFound();
  const { data: vids } = await sb
    .from("videos")
    .select("id,platform,source_url,embed_url,avg_rating,rating_count,played_at,submitted_by")
    .eq("group_id", group.id)
    .eq("status", "played")
    .neq("platform", "upload") // personal videos are deleted after they play, so they never join the Top 100
    .gt("rating_count", 0)
    .order("avg_rating", { ascending: false })
    .order("rating_count", { ascending: false })
    .limit(100);
  const { data: players } = await sb.from("players").select("id,display_name,avatar_color").eq("group_id", group.id);
  const pm = new Map((players || []).map((p) => [p.id, p]));
  const items = (vids || []).map((v) => ({
    id: v.id,
    platform: v.platform,
    sourceUrl: v.source_url,
    embedUrl: v.embed_url,
    avg: Number(v.avg_rating),
    count: v.rating_count,
    playedAt: v.played_at,
    sender: pm.get(v.submitted_by)?.display_name ?? "Someone",
    senderColor: pm.get(v.submitted_by)?.avatar_color ?? "#999",
  }));
  return (
    <>
      <TopBar name={mod.display_name} isAdmin={mod.is_admin} back={{ href: `/g/${group.id}`, label: group.name }} />
      <main className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        <h1 className="title mt-2 text-4xl text-sunny sm:text-5xl">🏆 Top 100</h1>
        <p className="mt-1 text-white/70">
          {group.emoji} {group.name}: the highest rated videos of all time
        </p>
        <TopList items={items} />
      </main>
    </>
  );
}
