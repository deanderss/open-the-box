import Link from "next/link";

export default function PausedView({
  groupId,
  index,
  total,
  busy,
  onResume,
}: {
  groupId: string;
  index: number;
  total: number;
  busy: boolean;
  onResume: () => void;
}) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-10 text-center">
      <p className="text-7xl">⏸</p>
      <h1 className="title text-5xl text-sunny">Game paused</h1>
      <p className="max-w-md text-xl text-white/80">
        Video {index + 1} of {total}. Players see a &ldquo;paused&rdquo; screen and the timer is frozen. Resume whenever you&apos;re ready, even later or from another device.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button className="btn btn-yellow text-2xl" disabled={busy} onClick={onResume}>
          ▶ Resume game
        </button>
        <Link href={`/g/${groupId}`} className="btn btn-ghost">
          Back to the box
        </Link>
      </div>
    </section>
  );
}
