import { headers } from "next/headers";
import BoxMascot from "@/components/BoxMascot";
import { HttpError } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { loadSubmitPage } from "@/lib/submitLookup";
import SubmitClient from "./SubmitClient";

export const dynamic = "force-dynamic";

/**
 * Whose box a submit link belongs to, and its roster, were previously fetched client-side on mount — every
 * single visit (every player, from a cold mobile browser, usually straight off a chat link) paid for a full
 * extra round trip and a "Finding the box…" spinner just to learn something the server already knew the
 * instant the request came in. Looking it up here instead means that's already baked into the HTML by the
 * time it reaches the phone; `SubmitClient` only has to handle what's actually interactive.
 */
export default async function SubmitPage({ params }: { params: { token: string } }) {
  // This used to ride along with `GET /api/submit`'s own limiter; doing the lookup directly in the page
  // instead of through that route means it needs the same guard against someone hammering a page load to
  // grind through tokens.
  const ip = (headers().get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (!rateLimit(`submitpage:${ip}`, 120, 60 * 60 * 1000)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <BoxMascot size={150} mood="meh" />
        <p className="title mt-6 text-2xl">Slow down!</p>
        <p className="mt-2 text-white/70">Try again in a bit.</p>
      </main>
    );
  }
  try {
    const initial = await loadSubmitPage(params.token);
    return <SubmitClient token={params.token} initial={initial} />;
  } catch (e) {
    const message = e instanceof HttpError ? e.message : "Something went wrong";
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <BoxMascot size={150} mood="meh" />
        <p className="title mt-6 text-2xl">{message}</p>
        <p className="mt-2 text-white/70">Ask your moderator for the latest link.</p>
      </main>
    );
  }
}
