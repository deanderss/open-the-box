"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@/components/Box";

export default function OpenBoxButton({ groupId, count }: { groupId: string; count: number }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-center py-6">
      <Box
        size={300}
        count={count}
        disabled={count === 0}
        label={count === 0 ? "The box is empty. Share the link to collect videos!" : "Click the box to open it!"}
        onOpened={async () => {
          const res = await fetch("/api/session/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId }) });
          const d = await res.json();
          if (!res.ok) return setErr(d.error);
          router.push(`/g/${groupId}/play?session=${d.sessionId}`);
        }}
      />
      {err && <p className="mt-3 text-[#FFB3B3]">{err}</p>}
    </div>
  );
}
