"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";

export default function RosterPanel({ groupId, players }: { groupId: string; players: { id: string; name: string; color: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="card">
      <p className="title text-xl">👥 Team roster ({players.length})</p>
      <p className="mt-1 text-sm text-white/70">These are the names people pick when they send videos and join a game.</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          const res = await fetch(`/api/groups/${groupId}/players`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
          const d = await res.json();
          if (!res.ok) return setErr(d.error);
          setName("");
          router.refresh();
        }}
      >
        <input className="input py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a teammate" maxLength={40} />
        <button className="btn btn-mint btn-sm">Add</button>
      </form>
      {err && <p className="mt-2 text-sm text-[#FFB3B3]">{err}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {players.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-full bg-black/30 py-1 pl-1 pr-3">
            <Avatar name={p.name} color={p.color} size={32} />
            <span className="font-semibold">{p.name}</span>
            <button
              className="ml-1 text-white/70 hover:text-[#FF5E5E]"
              title="Remove"
              onClick={async () => {
                if (!confirm(`Remove ${p.name} from the roster? Their past scores are kept.`)) return;
                await fetch(`/api/groups/${groupId}/players?playerId=${p.id}`, { method: "DELETE" });
                router.refresh();
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
