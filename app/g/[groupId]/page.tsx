import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import TopBar from "@/components/TopBar";
import { getMe } from "@/lib/me";
import { supabaseAdmin } from "@/lib/supabase-server";
import OpenBoxButton from "./OpenBoxButton";
import SharePanel from "./SharePanel";
import RosterPanel from "./RosterPanel";
import ModsPanel from "./ModsPanel";

export const dynamic = "force-dynamic";

export default async function GroupLobby({ params }: { params: { groupId: string } }) {
  const { sb, mod } = await getMe();
  const { data: group } = await sb.from("groups").select("id,name,color,emoji,owner_id,submit_token").eq("id", params.groupId).maybeSingle();
  if (!group) notFound();

  const [{ data: players }, { count: queued }, { count: played }, { data: gm }, { data: active }] = await Promise.all([
    sb.from("players").select("id,display_name,avatar_color").eq("group_id", group.id).eq("active", true).order("display_name"),
    sb.from("videos").select("id", { count: "exact", head: true }).eq("group_id", group.id).eq("status", "queued"),
    sb.from("videos").select("id", { count: "exact", head: true }).eq("group_id", group.id).eq("status", "played"),
    sb.from("group_moderators").select("moderator_id,role").eq("group_id", group.id),
    // An unfinished game (paused or just left open) that can be resumed
    sb.from("sessions").select("id,state,current_index,video_order,paused_at").eq("group_id", group.id).is("ended_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const inProgress = active && (active.state === "playing" || active.state === "reveal")
    ? { sessionId: active.id as string, paused: !!active.paused_at, videoNumber: (active.current_index as number) + 1, total: (active.video_order as string[]).length }
    : null;
  const modIds = (gm || []).map((m) => m.moderator_id);
  const { data: modProfiles } = modIds.length ? await supabaseAdmin().from("moderators").select("id,display_name,email").in("id", modIds) : { data: [] };
  const mods = (gm || []).map((m) => ({ ...m, ...(modProfiles || []).find((p) => p.id === m.moderator_id) }));

  const h = headers();
  const origin = `${h.get("x-forwarded-proto") || "https"}://${h.get("x-forwarded-host") || h.get("host")}`;
  const isOwner = group.owner_id === mod.id;

  return (
    <>
      <TopBar name={mod.display_name} isAdmin={mod.is_admin} back={{ href: "/groups", label: "All boxes" }} />
      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="mb-6 mt-2 flex items-center gap-4">
          <span className="text-6xl">{group.emoji}</span>
          <div>
            <h1 className="title text-4xl sm:text-5xl" style={{ color: group.color }}>
              {group.name}
            </h1>
            <p className="text-white/70">
              {queued ?? 0} new video{queued === 1 ? "" : "s"} waiting · {played ?? 0} played
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="card flex flex-col items-center justify-center lg:col-span-2">
            <OpenBoxButton groupId={group.id} count={queued ?? 0} inProgress={inProgress} />
          </div>
          <div className="flex flex-col gap-4">
            <Link href={`/g/${group.id}/top`} className="card flex items-center gap-4 transition hover:-translate-y-1">
              <span className="text-5xl">🏆</span>
              <div>
                <p className="title text-2xl text-sunny">Top 100</p>
                <p className="text-sm text-white/70">Highest rated videos, ready to rewatch</p>
              </div>
            </Link>
            <Link href={`/g/${group.id}/leaderboard`} className="card flex items-center gap-4 transition hover:-translate-y-1">
              <span className="text-5xl">🕵️</span>
              <div>
                <p className="title text-2xl text-mint">Leaderboard</p>
                <p className="text-sm text-white/70">Who&apos;s the best at guessing the sender?</p>
              </div>
            </Link>
            <SharePanel groupId={group.id} origin={origin} token={group.submit_token} />
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <RosterPanel groupId={group.id} players={(players || []).map((p) => ({ id: p.id, name: p.display_name, color: p.avatar_color }))} />
          <ModsPanel
            groupId={group.id}
            isOwner={isOwner}
            meId={mod.id}
            mods={mods.map((m) => ({ id: m.moderator_id, name: m.display_name || "Moderator", email: m.email || "", role: m.role }))}
          />
        </div>
      </main>
    </>
  );
}
