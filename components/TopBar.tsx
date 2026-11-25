import Link from "next/link";
import LogoutButton from "./LogoutButton";

export default function TopBar({ name, isAdmin, back }: { name?: string; isAdmin?: boolean; back?: { href: string; label: string } }) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
      <div className="flex items-center gap-4">
        <Link href="/groups" className="title flex items-center gap-2 text-2xl text-sunny">
          <span className="text-3xl">📦</span> Open the Box
        </Link>
        {back && (
          <Link href={back.href} className="btn btn-ghost btn-sm">
            ← {back.label}
          </Link>
        )}
      </div>
      <div className="flex items-center gap-3">
        {isAdmin && (
          <Link href="/admin" className="btn btn-ghost btn-sm">
            🛠 Moderators
          </Link>
        )}
        {name && <span className="hidden text-white/70 sm:inline">Hi, {name}!</span>}
        <LogoutButton />
      </div>
    </header>
  );
}
