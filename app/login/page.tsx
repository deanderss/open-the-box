"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Box from "@/components/Box";
import { supabaseBrowser } from "@/lib/supabase-browser";

function LoginInner() {
  const params = useSearchParams();
  const next = params.get("next") || "/groups";
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [slots, setSlots] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/slots").then((r) => r.json()).then((d) => setSlots(d.remaining ?? 0)).catch(() => setSlots(0));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, password }) });
        const d = await res.json();
        if (!res.ok) {
          if (d.error === "box_full") {
            setSlots(0);
            setMode("login");
            throw new Error("All moderator seats are taken.");
          }
          throw new Error(d.error || "Sign up failed");
        }
        if (d.pending) {
          // Needs admin approval before they can log in.
          setPassword("");
          setMode("login");
          setNotice("🎉 Request sent! You'll be able to log in once the admin approves you. Try again later with the same email and password.");
          return;
        }
      }
      const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        if (/banned/i.test(error.message)) throw new Error("⏳ Your moderator request is still waiting for approval. Check back soon!");
        throw new Error(error.message === "Invalid login credentials" ? "Wrong email or password" : error.message);
      }
      window.location.href = next.startsWith("/") ? next : "/groups";
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const full = slots !== null && slots <= 0;

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-10 md:grid-cols-2">
      <div className="flex flex-col items-center text-center">
        <h1 className="title text-5xl text-sunny sm:text-6xl">Open the Box</h1>
        <p className="mt-3 max-w-sm text-lg text-white/80">Send in videos all week. Open the box at the end of the meeting. Rate them. Guess who sent them!</p>
        <div className="mt-8">
          <Box size={240} disabled label="Moderators only — log in to open" />
        </div>
      </div>
      <div className="card mx-auto w-full max-w-md">
        <div className="mb-6 flex rounded-2xl bg-black/30 p-1">
          <button className={`flex-1 rounded-xl py-2 font-display text-lg ${mode === "login" ? "bg-sunny text-night" : "text-white/70"}`} onClick={() => setMode("login")}>
            Log in
          </button>
          <button
            className={`flex-1 rounded-xl py-2 font-display text-lg ${mode === "signup" ? "bg-bubble text-white" : "text-white/70"} disabled:opacity-40`}
            onClick={() => setMode("signup")}
            disabled={full}
          >
            Sign up {full ? "🔒" : ""}
          </button>
        </div>
        {full && mode === "login" && (
          <div className="mb-4 rounded-2xl bg-black/30 p-3 text-sm text-white/80">🔒 The box is full: all moderator seats are taken. Ask your admin to free one up.</div>
        )}
        {!full && slots !== null && mode === "signup" && (
          <div className="mb-4 rounded-2xl bg-black/30 p-3 text-sm text-white/80">🎟 {slots} moderator seat{slots === 1 ? "" : "s"} left. New moderators need admin approval before they can log in.</div>
        )}
        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="label">Your name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} placeholder="Jordan" />
            </div>
          )}
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@company.com" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "signup" ? 8 : 1} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="••••••••" />
          </div>
          {notice && <p className="rounded-xl bg-mint/20 p-3 text-sm text-mint">{notice}</p>}
          {err && <p className="rounded-xl bg-[#FF5E5E]/20 p-3 text-sm text-[#FFB3B3]">{err}</p>}
          <button className={`btn w-full ${mode === "login" ? "btn-yellow" : "btn-pink"}`} disabled={busy}>
            {busy ? "One sec…" : mode === "login" ? "Let's go!" : "Request moderator access"}
          </button>
        </form>
        {mode === "login" && (
          <p className="mt-4 text-center text-sm text-white/60">
            <Link href="/forgot" className="underline hover:text-white">
              Forgot password?
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
