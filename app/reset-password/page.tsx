"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function ResetPassword() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="card">
        <h1 className="title mb-4 text-3xl text-sunny">Choose a new password</h1>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
            if (error) setErr(error.message);
            else window.location.href = "/groups";
          }}
        >
          <input className="input" type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (8+ chars)" />
          {err && <p className="text-sm text-[#FFB3B3]">{err}</p>}
          <button className="btn btn-pink w-full">Save password</button>
        </form>
      </div>
    </main>
  );
}
