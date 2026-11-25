"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type M = { id: string; name: string; email: string; isAdmin: boolean; suspended: boolean; createdAt: string; boxes: number };
type Req = { id: string; name: string; email: string; status: "pending" | "approved" | "denied"; ip: string | null; userAgent: string | null; createdAt: string; decidedAt: string | null };

const fmt = (d: string) => new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function AdminPanel({ meId, cap, mods, requests }: { meId: string; cap: number; mods: M[]; requests: Req[] }) {
  const router = useRouter();
  const [newCap, setNewCap] = useState(cap);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = requests.filter((r) => r.status === "pending");
  const history = requests.filter((r) => r.status !== "pending");
  const used = mods.length + pending.length;

  async function decide(r: Req, action: "approve" | "deny") {
    if (action === "deny" && !confirm(`Deny ${r.name} (${r.email})? Their account will be deleted.`)) return;
    setBusyId(r.id);
    const res = await fetch("/api/admin/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action }) });
    if (!res.ok) alert((await res.json()).error);
    setBusyId(null);
    router.refresh();
  }

  return (
    <>
      <div className="card mt-6 border-2 border-sunny/40">
        <div className="flex items-center justify-between">
          <p className="title text-2xl">📬 Pending requests</p>
          <span className={`rounded-full px-3 py-1 font-bold ${pending.length ? "bg-bubble text-white" : "bg-black/30 text-white/60"}`}>{pending.length}</span>
        </div>
        {pending.length === 0 ? (
          <p className="mt-3 text-white/60">Nobody is waiting. You&apos;ll get an email when someone asks to join.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {pending.map((r) => (
              <li key={r.id} className="rounded-2xl bg-black/25 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-lg">{r.name}</p>
                    <p className="break-all text-sm text-white/80">{r.email}</p>
                    <p className="mt-1 text-xs text-white/50">
                      Requested {fmt(r.createdAt)} · IP {r.ip || "unknown"}
                    </p>
                    {r.userAgent && <p className="mt-0.5 break-words text-xs text-white/40">{r.userAgent}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-mint btn-sm" disabled={busyId === r.id} onClick={() => decide(r, "approve")}>
                      Approve
                    </button>
                    <button className="btn btn-danger btn-sm" disabled={busyId === r.id} onClick={() => decide(r, "deny")}>
                      Deny
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

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
            <input className="input w-28 py-2" type="number" min={1} max={50} value={newCap} onChange={(e) => setNewCap(Number(e.target.value))} />
          </div>
          <button className="btn btn-yellow btn-sm">Save</button>
          {msg && <span className="pb-2 text-sm text-white/70">{msg}</span>}
        </form>
      </div>

      <h2 className="title mt-8 text-2xl">Moderators</h2>
      <p className="text-sm text-white/60">Click a moderator to see their boxes and who&apos;s in them, or to suspend or remove them.</p>
      <ul className="mt-3 space-y-3">
        {mods.map((m) => (
          <li key={m.id}>
            <Link href={`/admin/moderators/${m.id}`} className="card flex items-center justify-between gap-3 p-4 transition hover:-translate-y-0.5">
              <div className="min-w-0">
                <p className="font-display text-lg">
                  {m.name} {m.isAdmin && <span className="ml-1 rounded-full bg-sunny px-2 py-0.5 text-xs text-night">admin</span>}
                  {m.suspended && <span className="ml-1 rounded-full bg-[#FF5E5E] px-2 py-0.5 text-xs text-white">suspended</span>}
                </p>
                <p className="break-all text-sm text-white/60">
                  {m.email} · owns {m.boxes} box{m.boxes === 1 ? "" : "es"} · joined {new Date(m.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span className="shrink-0 font-display text-sunny">{m.id === meId ? "View →" : "Manage →"}</span>
            </Link>
          </li>
        ))}
      </ul>

      {history.length > 0 && (
        <>
          <h2 className="title mt-8 text-2xl">Request history</h2>
          <ul className="mt-3 space-y-2">
            {history.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-black/20 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <span className="font-bold">{r.name}</span> <span className="break-all text-white/60">{r.email}</span>
                  <p className="text-xs text-white/40">
                    Requested {fmt(r.createdAt)}
                    {r.decidedAt ? ` · decided ${fmt(r.decidedAt)}` : ""} · IP {r.ip || "unknown"}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-0.5 text-xs font-bold ${r.status === "approved" ? "bg-mint text-night" : "bg-[#FF5E5E] text-white"}`}>{r.status}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
