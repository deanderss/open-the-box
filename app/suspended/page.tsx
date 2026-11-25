import LogoutButton from "@/components/LogoutButton";

export default function SuspendedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-7xl">🚧</p>
      <h1 className="title text-4xl text-sunny">Account suspended</h1>
      <p className="max-w-md text-white/80">An admin has paused this moderator account. Your boxes are safe. Ask the admin if you think this is a mistake.</p>
      <LogoutButton />
    </main>
  );
}
