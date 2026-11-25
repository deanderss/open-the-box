"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import Avatar from "@/components/Avatar";
import BoxMascot, { Mood } from "@/components/BoxMascot";

type Roster = { id: string; name: string; color: string }[];
type Result = { url: string; status: "added" | "duplicate" | "invalid" | "full" | "error"; message?: string };

// Personal videos from the camera roll (see lib/uploads.ts for the server side of these limits)
const MAX_UPLOAD_MB = 50;
const MAX_FILES = 5;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|3gp)$/i;
const isVideoFile = (f: File) => f.type.startsWith("video/") || VIDEO_EXT.test(f.name);

/** PUT the file to its one-time signed URL, reporting progress (fetch can't do upload progress). */
function putFile(url: string, file: File, type: string, onProgress: (frac: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Content-Type", type);
    x.setRequestHeader("x-upsert", "false");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status < 300 ? resolve() : reject(new Error(x.status === 413 ? `That video is over ${MAX_UPLOAD_MB} MB` : `Upload failed (${x.status})`)));
    x.onerror = () => reject(new Error("Lost the connection while uploading"));
    x.send(file);
  });
}
type Verdict = "rock" | "meh" | "stink";

const STATUS: Record<Result["status"], { icon: string; text: string }> = {
  added: { icon: "✅", text: "In the box" },
  duplicate: { icon: "🙃", text: "Someone beat you to it, already in the box" },
  invalid: { icon: "❌", text: "Not a TikTok, Instagram, Facebook or YouTube Shorts video" },
  full: { icon: "📦", text: "Box is stuffed full" },
  error: { icon: "⚠️", text: "That one didn't make it in" },
};

const TAUNTS = [
  "These better be good…",
  "No pressure, but the whole team is watching.",
  "The box has standards. Low ones, but still.",
  "Choose wisely. Your reputation depends on it.",
  "Remember: nobody knows it was you… yet.",
];

const SCANNING = [
  "Downloading vibes…",
  "Counting dance moves…",
  "Measuring cringe levels…",
  "Consulting the council of cats…",
  "Checking for questionable lip-syncing…",
  "Calculating LOLs per second…",
];

const VERDICTS: Record<Verdict, { lines: string[]; sub: string[]; color: string; mood: Mood }> = {
  rock: {
    lines: ["…and they ROCK!!! 🤘", "…and they're ABSOLUTE BANGERS! 🔥", "…and it laughed so hard it blew a fuse! 😂", "…and they're certified 10/10 bangers! 🏆"],
    sub: ["The box is honored to hold these.", "Your teammates aren't ready.", "Legend behavior, honestly."],
    color: "text-mint",
    mood: "rock",
  },
  meh: {
    lines: ["…and they're… fine. 😐", "…and it shrugged. 🤷", "…and they're a solid 'eh'. 😶", "…and it's still deciding how it feels. 🫠"],
    sub: ["Not bad. Not great. Very… medium.", "The box has seen better. And worse.", "Could go either way at the meeting!"],
    color: "text-sunny",
    mood: "meh",
  },
  stink: {
    lines: ["…and they STINK. 🤢", "…and it would like its 30 seconds back. 🙄", "…and it's filing a formal complaint. 📝", "…and it needs to lie down. 🫣"],
    sub: ["Bold choices. Very bold.", "The team will be the judge of that… 😬", "The box is questioning your taste."],
    color: "text-[#FF8A8A]",
    mood: "stink",
  },
};

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
function rollVerdict(): Verdict {
  const r = Math.random();
  return r < 0.4 ? "rock" : r < 0.7 ? "meh" : "stink";
}
function platformOf(u: string) {
  if (/tiktok\.com/i.test(u)) return "🎵";
  if (/instagram\.com|instagr\.am/i.test(u)) return "📸";
  if (/facebook\.com|fb\.watch|fb\.com/i.test(u)) return "📘";
  if (/youtube\.com\/shorts/i.test(u)) return "▶️";
  return u.trim() ? "❓" : "🔗";
}

function stinkRain() {
  const fly = confetti.shapeFromText ? confetti.shapeFromText({ text: "🪰", scalar: 2 }) : undefined;
  const poo = confetti.shapeFromText ? confetti.shapeFromText({ text: "💨", scalar: 2 }) : undefined;
  confetti({ particleCount: 25, spread: 120, startVelocity: 25, gravity: 0.6, scalar: 2, origin: { y: 0.3 }, ...(fly && poo ? { shapes: [fly, poo] } : { colors: ["#7a8b3a", "#5b4a2e"] }) });
}

export default function SubmitPage({ params }: { params: { token: string } }) {
  const [group, setGroup] = useState<{ name: string; color: string; emoji: string } | null>(null);
  const [roster, setRoster] = useState<Roster>([]);
  const [err, setErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [links, setLinks] = useState<string[]>([""]);
  const [files, setFiles] = useState<File[]>([]);
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"form" | "scanning" | "result">("form");
  const [results, setResults] = useState<Result[] | null>(null);
  const [verdict, setVerdict] = useState<Verdict>("rock");
  const [verdictLine, setVerdictLine] = useState("");
  const [verdictSub, setVerdictSub] = useState("");
  const [showVerdict, setShowVerdict] = useState(false);
  const [scanMsg, setScanMsg] = useState(SCANNING[0]);
  const [taunt] = useState(() => pick(TAUNTS.slice(1)));
  const storeKey = `otb-submitter-${params.token}`;

  useEffect(() => {
    fetch(`/api/submit?token=${encodeURIComponent(params.token)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setGroup(d.group);
        setRoster(d.roster);
        const saved = localStorage.getItem(storeKey);
        if (saved && d.roster.some((p: { id: string }) => p.id === saved)) setPlayerId(saved);
      })
      .catch((e) => setErr(e.message));
  }, [params.token, storeKey]);

  // rotate fake "AI" messages while scanning
  useEffect(() => {
    if (phase !== "scanning") return;
    let i = 0;
    const t = setInterval(() => setScanMsg(SCANNING[++i % SCANNING.length]), 650);
    return () => clearInterval(t);
  }, [phase]);

  const me = roster.find((p) => p.id === playerId);
  const filled = links.filter((l) => l.trim()).length + files.length;
  const added = results?.filter((r) => r.status === "added").length ?? 0;

  const mood: Mood = useMemo(() => {
    if (phase === "scanning") return "chomp";
    if (phase === "result") return added === 0 ? "meh" : showVerdict ? VERDICTS[verdict].mood : "idle";
    return filled > 0 ? "hungry" : "idle";
  }, [phase, filled, added, showVerdict, verdict]);

  function reveal(v: Verdict) {
    setVerdict(v);
    setVerdictLine(pick(VERDICTS[v].lines));
    setVerdictSub(pick(VERDICTS[v].sub));
    setShowVerdict(false);
    setTimeout(() => {
      setShowVerdict(true);
      if (v === "rock") confetti({ particleCount: 180, spread: 100, origin: { y: 0.35 }, colors: ["#FF4FA3", "#FFD23F", "#3DDC97", "#3FC1FF", "#FF8A3D"] });
      if (v === "stink") stinkRain();
      if (navigator.vibrate) navigator.vibrate(v === "stink" ? [80, 60, 80] : 60);
    }, 1400);
  }

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    const notes: string[] = [];
    for (const f of Array.from(list)) {
      if (!isVideoFile(f)) notes.push(`${f.name} isn't a video`);
      else if (f.size > MAX_UPLOAD_MB * 1048576) notes.push(`${f.name} is ${(f.size / 1048576).toFixed(0)} MB. The limit is ${MAX_UPLOAD_MB} MB, so trim it or pick a shorter clip`);
      else if (next.length >= MAX_FILES) notes.push(`Only ${MAX_FILES} videos at a time`);
      else next.push(f);
    }
    setFiles(next);
    setFileMsg(notes.length ? notes.join(". ") : null);
    if (fileInput.current) fileInput.current.value = "";
  }

  /** Upload one personal video: get a signed URL, send the file straight to storage, then add it to the box. */
  async function uploadOne(file: File, onProgress: (frac: number) => void): Promise<Result> {
    const post = async (path: string, payload: object) => {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: params.token, playerId, ...payload }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Something went wrong");
      return d;
    };
    try {
      const start = await post("/api/upload/start", { filename: file.name, contentType: file.type, size: file.size });
      await putFile(start.signedUrl, file, start.contentType, onProgress);
      const fin = await post("/api/upload/finish", { path: start.path });
      return { url: file.name, status: fin.status, message: fin.status === "added" ? "Your video is in the box. It disappears after it has been played." : undefined };
    } catch (err) {
      return { url: file.name, status: "error", message: err instanceof Error ? err.message : "Upload failed" };
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormErr(null);
    setPhase("scanning");
    setUploadPct(0);
    const minWait = new Promise((r) => setTimeout(r, 3200));
    const linkList = links.filter((l) => l.trim());
    try {
      const fileResults: Result[] = [];
      for (let i = 0; i < files.length; i++) {
        setUploadLabel(files.length > 1 ? `Uploading video ${i + 1} of ${files.length}…` : "Uploading your video…");
        fileResults.push(await uploadOne(files[i], (frac) => setUploadPct(((i + frac) / files.length) * 100)));
        setUploadPct(((i + 1) / files.length) * 100);
      }
      let linkResults: Result[] = [];
      if (linkList.length) {
        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: params.token, playerId, links: linkList }),
        });
        const d = await res.json();
        if (!res.ok) {
          await minWait;
          setFormErr(d.error);
          setFiles(files.filter((_, i) => fileResults[i]?.status !== "added")); // keep only the ones that didn't go in
          setPhase("form");
          return;
        }
        linkResults = d.results;
      }
      await minWait;
      const all = [...linkResults, ...fileResults];
      setResults(all);
      setPhase("result");
      if (all.some((r) => r.status === "added")) reveal(rollVerdict());
    } catch {
      setFormErr("Couldn't reach the box. Check your connection and try again.");
      setPhase("form");
    }
  }

  if (err)
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <BoxMascot size={150} mood="meh" />
        <p className="title mt-6 text-2xl">{err}</p>
        <p className="mt-2 text-white/70">Ask your moderator for the latest link.</p>
      </main>
    );
  if (!group)
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 text-white/60">
        <BoxMascot size={110} />
        Finding the box…
      </main>
    );

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 pb-10 pt-6">
      {/* header */}
      <div className="flex flex-col items-center text-center">
        <p className="title text-lg text-sunny">📦 Open the Box</p>
        <div className="mt-6">
          <BoxMascot size={phase === "form" ? 130 : 170} mood={mood} />
        </div>
        <h1 className="title mt-3 text-3xl" style={{ color: group.color }}>
          {group.emoji} {group.name}
        </h1>
      </div>

      <AnimatePresence mode="wait">
        {/* ── who are you ── */}
        {!me && phase === "form" && (
          <motion.div key="who" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }} className="card mt-6">
            <p className="title text-center text-2xl">Who goes there? 👀</p>
            <p className="mb-4 mt-1 text-center text-sm text-white/60">Pick your name. It stays secret until the big reveal 🤫</p>
            <div className="grid grid-cols-2 gap-3">
              {roster.map((p, i) => (
                <motion.button
                  key={p.id}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: i * 0.04, type: "spring", bounce: 0.5 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    setPlayerId(p.id);
                    localStorage.setItem(storeKey, p.id);
                  }}
                  className="flex items-center gap-2 rounded-2xl border-4 border-black/30 bg-black/30 p-3 text-left font-display text-lg shadow-chunkySm"
                >
                  <Avatar name={p.name} color={p.color} size={36} /> <span className="truncate">{p.name}</span>
                </motion.button>
              ))}
            </div>
            {roster.length === 0 && <p className="text-center text-white/70">Nobody's on the roster yet. Ask your moderator to add you!</p>}
          </motion.div>
        )}

        {/* ── link form ── */}
        {me && phase === "form" && (
          <motion.form key="form" onSubmit={submit} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="mt-6 space-y-4">
            <div className="flex items-center justify-between rounded-2xl bg-black/30 px-3 py-2">
              <div className="flex items-center gap-2">
                <Avatar name={me.name} color={me.color} size={34} />
                <span className="font-display text-lg">Sneaky {me.name}</span>
              </div>
              <button type="button" className="text-sm text-white/60 underline" onClick={() => setPlayerId(null)}>
                Not you?
              </button>
            </div>

            {/* the warning note */}
            <motion.div initial={{ rotate: -2 }} animate={{ rotate: [-2, 1, -2] }} transition={{ repeat: Infinity, duration: 3 }} className="rounded-2xl border-4 border-night bg-sunny p-4 text-night shadow-chunky">
              <p className="title text-2xl" style={{ textShadow: "none" }}>
                ⚠️ These better be good…
              </p>
              <p className="mt-1 text-sm font-semibold opacity-80">{taunt}</p>
            </motion.div>

            <div className="card space-y-3 p-4">
              <label className="label">Feed the box 🍽 (Reels, TikToks, Shorts, Facebook videos)</label>
              <AnimatePresence initial={false}>
                {links.map((l, i) => (
                  <motion.div key={i} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex items-center gap-2">
                    <span className="w-8 text-center text-2xl">{platformOf(l)}</span>
                    <input
                      className="input py-2 text-base"
                      value={l}
                      inputMode="url"
                      placeholder={i === 0 ? "Paste a video link…" : "Another one? 👀"}
                      onChange={(e) => {
                        const v = e.target.value;
                        const parts = v.split(/\s+/).filter((x) => /^https?:\/\//i.test(x));
                        const next = [...links];
                        if (parts.length > 1) next.splice(i, 1, ...parts);
                        else next[i] = v;
                        setLinks(next.slice(0, 15));
                      }}
                    />
                    {links.length > 1 && (
                      <button type="button" className="btn btn-ghost btn-sm px-3" onClick={() => setLinks(links.filter((_, j) => j !== i))} aria-label="Remove link">
                        ✕
                      </button>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {links.length < 15 && (
                <button type="button" className="btn btn-ghost btn-sm w-full" onClick={() => setLinks([...links, ""])}>
                  + Add another
                </button>
              )}
              <p className="text-center text-xs text-white/50">Tip: paste a bunch of links at once and they&apos;ll split up automatically.</p>
            </div>

            <div className="card space-y-3 p-4">
              <label className="label">Or add your own video 🎞 (from your camera roll)</label>
              <input ref={fileInput} type="file" accept="video/*" multiple className="hidden" onChange={(e) => pickFiles(e.target.files)} />
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-2xl bg-black/30 px-3 py-2 text-sm">
                  <span className="text-xl">🎞</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{f.name}</span>
                    <span className="block text-xs text-white/50">{(f.size / 1048576).toFixed(1)} MB</span>
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm px-3" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove video">
                    ✕
                  </button>
                </div>
              ))}
              {files.length < MAX_FILES && (
                <button type="button" className="btn btn-ghost btn-sm w-full" onClick={() => fileInput.current?.click()}>
                  🎞 {files.length ? "Add another video" : "Pick a video from your phone"}
                </button>
              )}
              {fileMsg && <p className="rounded-xl bg-[#FF5E5E]/20 p-2 text-center text-xs text-[#FFB3B3]">{fileMsg}</p>}
              <p className="text-center text-xs text-white/50">Up to {MAX_UPLOAD_MB} MB each (about 30 seconds of phone video). It plays once in the game, then it&apos;s deleted for good.</p>
            </div>

            {formErr && <p className="rounded-xl bg-[#FF5E5E]/20 p-3 text-center text-sm text-[#FFB3B3]">{formErr}</p>}
            <motion.button whileTap={{ scale: 0.95 }} className="btn btn-pink w-full text-2xl" disabled={filled === 0}>
              {filled === 0 ? "Feed me videos 📦" : `Drop ${filled} in the box 📦`}
            </motion.button>
          </motion.form>
        )}

        {/* ── fake AI scanning ── */}
        {phase === "scanning" && (
          <motion.div key="scan" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card mt-6 text-center">
            <p className="title text-2xl">🤖 The AI is watching your videos…</p>
            <div className="mt-5 h-5 overflow-hidden rounded-full border-4 border-black/30 bg-black/30">
              {files.length > 0 ? (
                <div className="h-full bg-gradient-to-r from-bubble via-sunny to-mint transition-[width] duration-300" style={{ width: `${Math.max(4, uploadPct)}%` }} />
              ) : (
                <motion.div className="h-full bg-gradient-to-r from-bubble via-sunny to-mint" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 3, ease: "easeInOut" }} />
              )}
            </div>
            {files.length > 0 && <p className="mt-3 font-display text-lg text-sunny">{uploadLabel} {Math.round(uploadPct)}%</p>}
            {files.length > 0 && <p className="text-xs text-white/50">Keep this screen open until it finishes.</p>}
            <AnimatePresence mode="wait">
              <motion.p key={scanMsg} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mt-4 font-display text-lg text-white/80">
                {scanMsg}
              </motion.p>
            </AnimatePresence>
          </motion.div>
        )}

        {/* ── verdict ── */}
        {phase === "result" && results && (
          <motion.div key="result" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">
            {added > 0 ? (
              <div className="card text-center">
                <p className="font-display text-xl text-white/80">The AI watched {added === 1 ? "this video" : "these videos"}…</p>
                <AnimatePresence mode="wait">
                  {showVerdict ? (
                    <motion.div key={verdictLine} initial={{ scale: 0.3, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: "spring", bounce: 0.6 }}>
                      <p className={`title mt-2 text-4xl ${VERDICTS[verdict].color}`}>{verdictLine}</p>
                      <p className="mt-2 text-white/70">{verdictSub}</p>
                    </motion.div>
                  ) : (
                    <motion.p key="dots" className="title mt-2 text-4xl text-white/60" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 0.9 }}>
                      …
                    </motion.p>
                  )}
                </AnimatePresence>
                <p className="mt-4 rounded-2xl bg-black/30 px-3 py-2 font-display text-lg text-sunny">
                  📦 {added} video{added === 1 ? "" : "s"} dropped in the box
                </p>
                <p className="mt-3 text-[11px] text-white/40">*The &quot;AI&quot; is a cardboard box. It has no eyes. Your team decides for real at the meeting.</p>
              </div>
            ) : (
              <div className="card text-center">
                <p className="title text-2xl">Hmm… nothing new went in 🤔</p>
                <p className="mt-1 text-white/70">Check the links below and try again.</p>
              </div>
            )}

            <ul className="space-y-2">
              {results.map((r, i) => (
                <motion.li key={i} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.1 * i }} className="flex items-start gap-2 rounded-2xl bg-black/30 p-3 text-sm">
                  <span className="text-lg">{STATUS[r.status].icon}</span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{r.message || STATUS[r.status].text}</span>
                    <span className="block truncate text-xs text-white/50">{r.url}</span>
                  </span>
                </motion.li>
              ))}
            </ul>

            <div className="flex gap-3">
              {added > 0 && showVerdict && (
                <button className="btn btn-ghost btn-sm flex-1" onClick={() => reveal(rollVerdict())}>
                  🎲 Ask the AI again
                </button>
              )}
              <button
                className="btn btn-yellow flex-1"
                onClick={() => {
                  setResults(null);
                  setLinks([""]);
                  setFiles([]);
                  setFileMsg(null);
                  setShowVerdict(false);
                  setPhase("form");
                }}
              >
                Send more 📦
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
