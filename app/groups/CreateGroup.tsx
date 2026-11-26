"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const COLORS = ["#FF4FA3", "#FFD23F", "#3DDC97", "#3FC1FF", "#FF8A3D", "#B07CFF"];
const EMOJIS = ["📦", "🎁", "🎉", "🦄", "🍕", "🚀", "🐙", "🌮", "🎸", "🔥"];

export default function CreateGroup() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [players, setPlayers] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color, emoji, players: players.split(/[\n,]/) }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(d.error);
    router.push(`/g/${d.id}`);
    router.refresh();
  }

  return (
    <>
      <button className="btn btn-pink" onClick={() => setOpen(true)}>
        + Create Group
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <form onSubmit={create} onClick={(e) => e.stopPropagation()} className="card max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto">
            <h2 className="title text-3xl text-sunny">New box</h2>
            <div>
              <label className="label">Group name</label>
              <input className="input" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing Mavericks" />
            </div>
            <div>
              <label className="label">Look</label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button type="button" key={c} onClick={() => setColor(c)} className={`h-10 w-10 rounded-full border-4 ${color === c ? "border-white" : "border-black/30"}`} style={{ background: c }} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {EMOJIS.map((em) => (
                  <button type="button" key={em} onClick={() => setEmoji(em)} className={`h-11 w-11 rounded-xl text-2xl ${emoji === em ? "bg-white/30" : "bg-white/5"}`}>
                    {em}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Team members (one per line or comma-separated)</label>
              <textarea className="input min-h-[120px]" value={players} onChange={(e) => setPlayers(e.target.value)} placeholder={"Alex\nSam\nJordan"} />
              <p className="mt-1 text-xs text-white/70">You can add or remove people later.</p>
            </div>
            {err && <p className="text-sm text-[#FFB3B3]">{err}</p>}
            <div className="flex gap-3">
              <button type="button" className="btn btn-ghost flex-1" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-yellow flex-1" disabled={busy}>
                {busy ? "Creating…" : "Create box"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
