"use client";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import Avatar from "@/components/Avatar";
import HostPlayerPanel from "@/components/HostPlayerPanel";
import type { useSeat } from "@/components/useSeat";
import type { GameState } from "@/components/useGameState";
import { useSmoothTv } from "@/lib/smoothTv";

// Only the lobby ever needs a QR code, so it's loaded on first use instead of sitting in the main bundle.
const QRCodeSVG = dynamic(() => import("qrcode.react").then((m) => m.QRCodeSVG), {
  ssr: false,
  loading: () => <div className="h-[220px] w-[220px] animate-pulse rounded-xl bg-black/10" />,
});

export default function LobbyView({
  state,
  joinUrl,
  busy,
  seatApi,
  onBegin,
  onKick,
}: {
  state: GameState;
  joinUrl: string;
  busy: boolean;
  seatApi: ReturnType<typeof useSeat>;
  onBegin: () => void;
  onKick: (playerId: string, name: string) => void;
}) {
  const s = state.session;
  const [smoothTv, setSmoothTv] = useSmoothTv();
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-10 lg:flex-row lg:gap-16">
      <div className="flex flex-col items-center text-center">
        <motion.h1 initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="title text-5xl text-sunny sm:text-7xl">
          The box is open!
        </motion.h1>
        <p className="mt-4 text-xl text-white/80">Grab your phone and join the game</p>
        <div className="mt-6 rounded-3xl bg-white p-5 shadow-chunky">
          <QRCodeSVG value={joinUrl || "https://"} size={220} />
        </div>
        <p className="mt-4 font-display text-6xl tracking-[0.35em] text-white">{s.code}</p>
      </div>
      <div className="flex w-full max-w-md flex-col gap-4">
        <div className="card">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="title block text-xl">📺 Playing on a TV?</span>
              <span className="text-sm text-white/70">Smooth TV mode keeps screen mirroring from dropping frames.</span>
            </span>
            <input type="checkbox" className="h-6 w-6 accent-[#3DDC97]" checked={smoothTv} onChange={(e) => setSmoothTv(e.target.checked)} aria-label="Smooth TV mode" />
          </label>
          {smoothTv && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-white/80">
              <li>Turn off Low Power Mode, and keep the phone plugged in.</li>
              <li>Close other apps and turn on Do Not Disturb.</li>
              <li>Put the Apple TV on Ethernet or 5 GHz Wi-Fi.</li>
              <li>The next video loads at the reveal, and the reveal effects are calmer.</li>
            </ul>
          )}
        </div>
        <div className="card">
          <p className="title text-2xl">Players in ({state.players.length})</p>
          <div className="mt-4 flex min-h-[120px] flex-wrap gap-3">
            <AnimatePresence>
              {state.players.map((p) => (
                <motion.button
                  key={p.id}
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0 }}
                  title="Click to remove"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => onKick(p.id, p.name)}
                  className="flex flex-col items-center gap-1"
                >
                  <span className="relative inline-block">
                    <Avatar name={p.name} color={p.color} size={64} />
                    <span aria-hidden className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#FF5E5E] text-sm font-bold leading-none text-white shadow-chunkySm">
                      ×
                    </span>
                  </span>
                  <span className="max-w-[72px] break-words text-sm font-semibold">{p.name}</span>
                </motion.button>
              ))}
            </AnimatePresence>
            {state.players.length === 0 && <p className="text-white/70">Waiting for players…</p>}
          </div>
          <button className="btn btn-yellow mt-6 w-full text-2xl" disabled={busy || state.players.length === 0} onClick={onBegin}>
            ▶ Start the show
          </button>
        </div>
        <HostPlayerPanel state={state} seatApi={seatApi} />
      </div>
    </section>
  );
}
