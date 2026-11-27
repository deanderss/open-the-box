// The post-game awards ceremony: who rated hardest, who rated softest, and the worst and best video of the
// game. Pure (no database), so it can be checked with plain sample data. Built from this game's own ratings
// only (decoys excluded), for videos that were actually shown and not skipped.

export type AwardKind = "hater" | "lover" | "stinker" | "banger";

export type Award = {
  kind: AwardKind;
  /** the winner: the rater for hater/lover, the sender for stinker/banger (null if the sender is unknown) */
  playerId: string | null;
  name: string;
  color: string;
  /** average rating: the player's own average for hater/lover, the video's average for stinker/banger */
  avg: number;
  /** how many ratings that average is built from */
  count: number;
  video?: { id: string; platform: string; sourceUrl: string };
};

/** Ceremony order, saving the best for last. */
export const AWARD_ORDER: AwardKind[] = ["hater", "lover", "stinker", "banger"];

/** `sessions.awards_step` value meaning "ceremony over" (anything >= the number of awards works). */
export const AWARDS_DONE = 99;

type Rating = { player_id: string; video_id: string; rating: number };
type ShownVideo = { id: string; platform: string; source_url: string; submitted_by: string | null; status: string };

export function computeAwards({
  ratings,
  shown,
  nameOf,
  colorOf,
}: {
  ratings: Rating[];
  /** videos shown this game, in the order they played */
  shown: ShownVideo[];
  nameOf: (id: string | null) => string | null;
  colorOf: (id: string | null) => string | null;
}): Award[] {
  const played = shown.filter((v) => v.status === "played");
  const order = new Map(played.map((v, i) => [v.id, i]));
  const rs = ratings.filter((r) => order.has(r.video_id) && typeof r.rating === "number");
  const awards = new Map<AwardKind, Award>();

  // Per-video averages, for the best and worst video.
  const byVideo = new Map<string, number[]>();
  rs.forEach((r) => byVideo.set(r.video_id, [...(byVideo.get(r.video_id) || []), r.rating]));
  const vids = Array.from(byVideo.entries()).map(([id, list]) => ({ v: played[order.get(id)!], avg: mean(list), count: list.length }));
  if (vids.length) {
    // Ties: more ratings wins, then whichever played earlier.
    const pick = (better: (a: number, b: number) => boolean) =>
      vids.reduce((best, x) =>
        better(x.avg, best.avg) || (x.avg === best.avg && (x.count > best.count || (x.count === best.count && order.get(x.v.id)! < order.get(best.v.id)!)))
          ? x
          : best
      );
    const asAward = (kind: AwardKind, x: (typeof vids)[number]): Award => ({
      kind,
      playerId: x.v.submitted_by,
      name: nameOf(x.v.submitted_by) ?? "A mystery guest",
      color: colorOf(x.v.submitted_by) ?? "#B07CFF",
      avg: x.avg,
      count: x.count,
      video: { id: x.v.id, platform: x.v.platform, sourceUrl: x.v.source_url },
    });
    const best = pick((a, b) => a > b);
    awards.set("banger", asAward("banger", best));
    // With a single rated video it would win both, so the stinker only shows up when there's a real choice.
    if (vids.length > 1) {
      const worst = pick((a, b) => a < b);
      if (worst.v.id !== best.v.id) awards.set("stinker", asAward("stinker", worst));
    }
  }

  // Per-player averages, for the hater and the lover.
  const byPlayer = new Map<string, number[]>();
  rs.forEach((r) => byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) || []), r.rating]));
  const minRatings = vids.length > 1 ? 2 : 1; // one rating isn't much of a pattern, unless that's all there was
  const people = Array.from(byPlayer.entries())
    .filter(([, list]) => list.length >= minRatings)
    .map(([id, list]) => ({ id, name: nameOf(id) ?? "Someone", avg: mean(list), count: list.length }));
  const distinct = new Set(people.map((p) => p.avg)).size;
  if (people.length >= 2 && distinct > 1) {
    // Ties: more ratings wins (a more committed hater), then alphabetical so it's stable between polls.
    const pick = (better: (a: number, b: number) => boolean) =>
      people.reduce((best, x) =>
        better(x.avg, best.avg) || (x.avg === best.avg && (x.count > best.count || (x.count === best.count && x.name < best.name))) ? x : best
      );
    const asAward = (kind: AwardKind, p: (typeof people)[number]): Award => ({
      kind,
      playerId: p.id,
      name: p.name,
      color: colorOf(p.id) ?? "#B07CFF",
      avg: p.avg,
      count: p.count,
    });
    awards.set("hater", asAward("hater", pick((a, b) => a < b)));
    awards.set("lover", asAward("lover", pick((a, b) => a > b)));
  }

  return AWARD_ORDER.filter((k) => awards.has(k)).map((k) => awards.get(k)!);
}

function mean(list: number[]) {
  return Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10;
}

/** Display copy and theming for each award, shared by the host ceremony, the finale recap and phones. */
export const AWARD_INFO: Record<AwardKind, { title: string; emoji: string; blurb: string; good: boolean }> = {
  hater: { title: "Biggest Hater", emoji: "😤", blurb: "Nothing impresses them. Lowest ratings of the night.", good: false },
  lover: { title: "Biggest Lover", emoji: "💖", blurb: "Loved it all. Highest ratings of the night.", good: true },
  stinker: { title: "A Real Stinker", emoji: "🤢", blurb: "The lowest-rated video of the night.", good: false },
  banger: { title: "Absolute Banger", emoji: "🔥", blurb: "The highest-rated video of the night.", good: true },
};
