"use client";
import { useState } from "react";
import dynamic from "next/dynamic";

// Most visits to this page never click "QR code" — loaded on first use instead of sitting in this page's
// initial bundle (same pattern as the lobby's own QR code in components/host/LobbyView.tsx).
const QRCodeSVG = dynamic(() => import("qrcode.react").then((m) => m.QRCodeSVG), {
  ssr: false,
  loading: () => <div className="h-[180px] w-[180px] animate-pulse rounded-xl bg-black/10" />,
});

export default function SharePanel({ groupId, origin, token }: { groupId: string; origin: string; token: string }) {
  const [tok, setTok] = useState(token);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const url = `${origin}/s/${tok}`;
  return (
    <div className="card">
      <p className="title text-xl text-sky">📲 Video drop link</p>
      <p className="mt-1 text-sm text-white/70">Share with your team. No login needed. Anyone with this link can drop videos into this box.</p>
      <div className="mt-3 break-all rounded-xl bg-black/30 p-3 font-mono text-xs text-white/80">{url}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="btn btn-sky btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowQr((s) => !s)}>
          {showQr ? "Hide QR" : "QR code"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            if (!confirm("Make a new link? The old link will stop working right away.")) return;
            const res = await fetch(`/api/groups/${groupId}/link`, { method: "POST" });
            const d = await res.json();
            if (res.ok) setTok(d.token);
          }}
        >
          ↻ New link
        </button>
      </div>
      {showQr && (
        <div className="mt-4 flex justify-center rounded-2xl bg-white p-4">
          <QRCodeSVG value={url} size={180} />
        </div>
      )}
    </div>
  );
}
