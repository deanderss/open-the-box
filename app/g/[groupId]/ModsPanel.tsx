"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ModsPanel({
  groupId,
  isOwner,
  meId,
  mods,
}: {
  groupId: string;
  isOwner: boolean;
  meId: string;
  mods: { id: string; name: string; email: string; role: string }[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="card">
      <p className="title text-xl">🎙 Moderators</p>
      <p className="mt-1 text-sm text-white/70">Co-moderators can see this box and run games. They need a moderator account first.</p>
      <ul className="mt-3 space-y-2">
        {mods.map((m) => (
          <li key={m.id} className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2">
            <span>
              <span className="font-semibold">{m.name}</span> <span className="text-sm text-white/50">{m.email}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${m.role === "owner" ? "bg-sunny text-night" : "bg-white/15"}`}>{m.role === "owner" ? "owner" : "co-mod"}</span>
              {m.role === "co" && (isOwner || m.id === meId) && (
                <button
                  className="text-white/40 hover:text-[#FF5E5E]"
                  onClick={async () => {
                    if (!confirm(m.id === meId ? "Leave this box?" : `Remove ${m.name}?`)) return;
                    await fetch(`/api/groups/${groupId}/moderators?moderatorId=${m.id}`, { method: "DELETE" });
                    if (m.id === meId) window.location.href = "/groups";
                    else router.refresh();
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          const res = await fetch(`/api/groups/${groupId}/moderators`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
          const d = await res.json();
          if (!res.ok) return setMsg(d.error);
          setEmail("");
          setMsg("Added! 🎉");
          router.refresh();
        }}
      >
        <input className="input py-2" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="co-moderator@company.com" required />
        <button className="btn btn-sky btn-sm">Invite</button>
      </form>
      {msg && <p className="mt-2 text-sm text-white/80">{msg}</p>}
      {isOwner && (
        <button
          className="btn btn-danger btn-sm mt-6"
          onClick={async () => {
            if (!confirm("Delete this box and ALL its videos, scores and history? This cannot be undone.")) return;
            await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
            window.location.href = "/groups";
          }}
        >
          Delete box
        </button>
      )}
    </div>
  );
}
