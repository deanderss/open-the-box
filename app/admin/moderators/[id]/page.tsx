import { notFound, redirect } from "next/navigation";
import TopBar from "@/components/TopBar";
import { getMe } from "@/lib/me";
import { supabaseAdmin } from "@/lib/supabase-server";
import ModeratorDetail from "./ModeratorDetail";

export const dynamic = "force-dynamic";

export default async function ModeratorPage({ params }: { params: { id: string } }) {
  const { mod: me } = await getMe();
  if (!me.is_admin) redirect("/groups");
  const db = supabaseAdmin();

  const { data: target } = await db.from("moderators").select("id,display_name,email,is_admin,suspended,created_at").eq("id", params.id).maybeSingle();
  if (!target) notFound();

  // Every box this moderator owns or co-moderates
  const { data: memberships } = await db.from("group_moderators").select("group_id,role").eq("moderator_id", target.id);
  const groupIds = (memberships || []).map((m) => m.group_id as string);

  const [{ data: groups }, { data: allMods }, { data: players }, { data: videos }, { data: sessions }] = groupIds.length
    ? await Promise.all([
        db.from("groups").select("id,name,emoji,color,owner_id,created_at").in("id", groupIds),
        db.from("group_moderators").select("group_id,moderator_id,role").in("group_id", groupIds),
        db.from("players").select("id,group_id,display_name,avatar_color").in("group_id", groupIds).eq("active", true).order("display_name"),
        // statuses only: never who sent what
        db.from("videos").select("group_id,status").in("group_id", groupIds),
        db.from("sessions").select("group_id,state,paused_at").in("group_id", groupIds).is("ended_at", null),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const modIds = Array.from(new Set((allMods || []).map((m) => m.moderator_id as string)));
  const { data: profiles } = modIds.length ? await db.from("moderators").select("id,display_name,email").in("id", modIds) : { data: [] };
  const profile = new Map((profiles || []).map((p) => [p.id as string, p]));

  const boxes = (groups || [])
    .map((g) => {
      const vids = (videos || []).filter((v) => v.group_id === g.id);
      const live = (sessions || []).find((s) => s.group_id === g.id);
      return {
        id: g.id as string,
        name: g.name as string,
        emoji: g.emoji as string,
        color: g.color as string,
        isOwner: g.owner_id === target.id,
        createdAt: g.created_at as string,
        queued: vids.filter((v) => v.status === "queued").length,
        played: vids.filter((v) => v.status === "played").length,
        liveState: live ? (live.paused_at ? "paused" : (live.state as string)) : null,
        moderators: (allMods || [])
          .filter((m) => m.group_id === g.id)
          .map((m) => ({ id: m.moderator_id as string, name: profile.get(m.moderator_id as string)?.display_name || "Moderator", email: profile.get(m.moderator_id as string)?.email || "", role: m.role as string })),
        players: (players || []).filter((p) => p.group_id === g.id).map((p) => ({ id: p.id as string, name: p.display_name as string, color: p.avatar_color as string })),
      };
    })
    .sort((a, b) => (a.isOwner === b.isOwner ? a.name.localeCompare(b.name) : a.isOwner ? -1 : 1));

  return (
    <>
      <TopBar name={me.display_name} isAdmin back={{ href: "/admin", label: "Moderators" }} />
      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <ModeratorDetail
          isSelf={target.id === me.id}
          moderator={{ id: target.id, name: target.display_name, email: target.email, isAdmin: target.is_admin, suspended: !!target.suspended, createdAt: target.created_at }}
          boxes={boxes}
        />
      </main>
    </>
  );
}
