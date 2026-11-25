"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type M = { id: string; name: string; email: string; isAdmin: boolean; createdAt: string; boxes: number };

export default function AdminPanel({ meId, cap, mods }: { meId: string; cap: number; mods: M[] }) {
  const router = useRouter();
  const [newCap, setNewCap] = useState(cap);
  const [msg, setMsg] = useState<string | null>(null);
  const used = mods.length;
  return (
    <>
      <div className="card mt-6">
        <div className="flex items-center justify-between">
          <p className="title text-2xl">
            {used} / {cap} seats used
          </p>
          <span className={`rounded-full px-3 py-1 font-bold ${used >= cap ? "bg-[#FF5E5E] text-white" : "bg-mint text-night"}`}>{used >= cap ? "🔒 Sign-up locked" : `${cap - used} open`}</span>
        </div>
        <div className="mt-3 h-4 overflow-hidden rounded-full bg-black/30">
          <div className="h-full bg-sunny" style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} />
        </div>
        <form
          className="mt-4 flex items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxModerators: newCap }) });
            const d = await res.json();
            setMsg(res.ok ? "Saved!" : d.error);
            router.refresh();
          }}
        >
          <div>
            <label className="label">Seat cap</label>
            <input className="input w-28 py-2" type="number" min={1} max={25} value={newCap} onChange={(e) => setNewCap(Number(e.target.value))} />
          </div>
          <button className="btn btn-yellow btn-sm">Save</button>
          {msg && <span className="pb-2 text-sm text-white/70">{msg}</span>}
        </form>
      </div>
      <ul className="mt-6 space-y-3">
        {mods.map((m) => (
          <li key={m.id} className="card flex items-center justify-between p-4">
            <div>
              <p className="font-display text-lg">
                {m.name} {m.isAdmin && <span className="ml-1 rounded-full bg-sunny px-2 py-0.5 text-xs text-night">admin</span>}
              </p>
              <p className="text-sm text-white/60">
                {m.email} · owns {m.boxes} box{m.boxes === 1 ? "" : "es"} · joined {new Date(m.createdAt).toLocaleDateString()}
              </p>
            </div>
            {m.id !== meId && (
              <button
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  if (!confirm(`Remove ${m.name}? Boxes they own will be handed to a co-moderator (or you).`)) return;
                  const res = await fetch(`/api/admin/moderators?id=${m.id}`, { method: "DELETE" });
                  if (!res.ok) alert((await res.json()).error);
                  router.refresh();
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
