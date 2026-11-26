"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";

type Mod = { id: string; name: string; email: string; isAdmin: boolean; suspended: boolean; createdAt: string };
type Box = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  isOwner: boolean;
  createdAt: string;
  queued: number;
  played: number;
  liveState: string | null;
  moderators: { id: string; name: string; email: string; role: string }[];
  players: { id: string; name: string; color: string }[];
};

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) {
    alert((await res.json().catch(() => ({}))).error || "Something went wrong");
    return false;
  }
  return true;
}

export default function ModeratorDetail({ moderator: m, boxes, isSelf }: { moderator: Mod; boxes: Box[]; isSelf: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const protectedAccount = isSelf || m.isAdmin;
  const owned = boxes.filter((b) => b.isOwner);

  async function run(fn: () => Promise<boolean>, after?: () => void) {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (ok) {
      after ? after() : router.refresh();
    }
  }

  return (
    <>
      <div className="card mt-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="title text-3xl text-sunny">
              {m.name}{" "}
              {m.isAdmin && <span className="ml-1 rounded-full bg-sunny px-2 py-0.5 align-middle text-xs text-night">admin</span>}
              {m.suspended && <span className="ml-1 rounded-full bg-[#FF5E5E] px-2 py-0.5 align-middle text-xs text-white">suspended</span>}
            </h1>
            <p className="break-all text-white/70">{m.email}</p>
            <p className="text-sm text-white/70">
              Joined {new Date(m.createdAt).toLocaleDateString()} · owns {owned.length} box{owned.length === 1 ? "" : "es"} · in {boxes.length} total
            </p>
          </div>
          {!protectedAccount && (
            <div className="flex flex-wrap gap-2">
              {m.suspended ? (
                <button className="btn btn-mint btn-sm" disabled={busy} onClick={() => run(() => call("/api/admin/moderators", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: m.id, action: "reactivate" }) }))}>
                  Reactivate
                </button>
              ) : (
                <button
                  className="btn btn-yellow btn-sm"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`Suspend ${m.name}? They are logged out of everything straight away and can't log in. Their boxes stay as they are. You can reactivate them any time.`)) return;
                    run(() => call("/api/admin/moderators", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: m.id, action: "suspend" }) }));
                  }}
                >
                  ⏸ Suspend account
                </button>
              )}
            </div>
          )}
        </div>
        {protectedAccount && <p className="mt-3 text-sm text-white/70">{isSelf ? "This is your own account." : "The admin account can't be suspended or removed."}</p>}
      </div>

      <h2 className="title mt-8 text-2xl">Boxes ({boxes.length})</h2>
      {boxes.length === 0 && <p className="mt-2 text-white/70">No boxes yet.</p>}
      <ul className="mt-3 space-y-4">
        {boxes.map((b) => (
          <li key={b.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-4xl">{b.emoji}</span>
                <div>
                  <p className="title text-2xl" style={{ color: b.color }}>
                    {b.name}
                  </p>
                  <p className="text-sm text-white/70">
                    {b.isOwner ? "Owner" : "Co-moderator"} · {b.queued} waiting · {b.played} played · created {new Date(b.createdAt).toLocaleDateString()}
                  </p>
                  {b.liveState && b.liveState !== "finished" && (
                    <p className="mt-1 inline-block rounded-full bg-bubble/30 px-2 py-0.5 text-xs">
                      🎬 Game {b.liveState === "paused" ? "paused" : b.liveState === "lobby" ? "in the lobby" : "in progress"}
                    </p>
                  )}
                </div>
              </div>
              <button
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={() => {
                  if (!confirm(`Delete the box "${b.name}" for good?\n\nAll of its players, videos, games and scores are deleted. This can't be undone.`)) return;
                  run(() => call(`/api/admin/groups?id=${b.id}`, { method: "DELETE" }));
                }}
              >
                Delete box
              </button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="label">Moderators ({b.moderators.length})</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {b.moderators.map((x) => (
                    <li key={x.id} className="flex items-center justify-between rounded-xl bg-black/25 px-3 py-1.5">
                      <span className="min-w-0">
                        <span className="font-semibold">{x.name}</span> <span className="break-all text-white/70">{x.email}</span>
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-white/70">{x.role === "owner" ? "owner" : "co-mod"}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="label">Players in the box ({b.players.length})</p>
                {b.players.length === 0 ? (
                  <p className="mt-1 text-sm text-white/70">No players yet.</p>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {b.players.map((p) => (
                      <span key={p.id} className="flex items-center gap-1.5 rounded-full bg-black/25 py-1 pl-1 pr-3 text-sm">
                        <Avatar name={p.name} color={p.color} size={26} /> {p.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {!protectedAccount && (
        <div className="card mt-10 border-2 border-[#FF5E5E]/40">
          <p className="title text-xl text-[#FF8A8A]">Danger zone</p>
          <p className="mt-1 text-sm text-white/70">Permanently delete this moderator&apos;s account.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                if (!confirm(`Delete ${m.name}'s account and KEEP their boxes?\n\nBoxes they own are handed to a co-moderator (or to you).`)) return;
                run(() => call(`/api/admin/moderators?id=${m.id}`, { method: "DELETE" }), () => router.push("/admin"));
              }}
            >
              Delete account, keep boxes
            </button>
            <button
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={() => {
                if (!confirm(`Delete ${m.name}'s account AND the ${owned.length} box${owned.length === 1 ? "" : "es"} they own?\n\nPlayers, videos, games and scores in those boxes are deleted. This can't be undone.`)) return;
                run(() => call(`/api/admin/moderators?id=${m.id}&boxes=delete`, { method: "DELETE" }), () => router.push("/admin"));
              }}
            >
              Delete account and their boxes
            </button>
          </div>
        </div>
      )}
    </>
  );
}
