"use client";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function LogoutButton() {
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        window.location.href = "/login";
      }}
    >
      Log out
    </button>
  );
}
