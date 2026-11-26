"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="card">
        <h1 className="title mb-4 text-3xl text-sunny">Reset password</h1>
        {sent ? (
          <p className="text-white/80">📬 If that email has an account, a reset link is on its way. Check your inbox.</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email.trim(), {
                redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
              });
              if (error) setErr(error.message);
              else setSent(true);
            }}
          >
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            {err && <p className="text-sm text-[#FFB3B3]">{err}</p>}
            <button className="btn btn-yellow w-full">Send reset link</button>
          </form>
        )}
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-white/70 underline">
            Back to login
          </Link>
        </p>
      </div>
    </main>
  );
}
