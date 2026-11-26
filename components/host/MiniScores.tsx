import Avatar from "@/components/Avatar";
import { fmtPoints } from "@/lib/points";

export default function MiniScores({ scores }: { scores: { playerId: string; name: string; color: string; points: number }[] }) {
  if (!scores.length) return null;
  return (
    <div className="card py-4">
      <p className="title mb-2 text-lg text-mint">🕵️ Tonight&apos;s detectives</p>
      <ol className="space-y-1">
        {scores.slice(0, 6).map((sc, i) => (
          <li key={sc.playerId} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="w-5 text-white/50">{i + 1}</span>
              <Avatar name={sc.name} color={sc.color} size={26} /> {sc.name}
            </span>
            <span className="font-display text-lg">{fmtPoints(sc.points)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
