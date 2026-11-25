/**
 * Full-bleed "scrolling reels" layout for third-party embeds.
 *
 * Each embed renders its own chrome (Instagram: white header + footer + black side bars, TikTok: a small
 * fixed card). We can't restyle a cross-origin iframe, but we CAN render it at its native layout size and
 * crop + scale it so only the video fills the screen. The numbers below were measured from the real
 * embeds (Instagram at 540px wide: 54px header, video 380x674 at x=80; TikTok: 325x578 card).
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type Layout =
  /** Render the iframe at iw x ih, then crop to `rect` and scale it up. `boost` caps how much we are
   *  willing to crop to fill a taller/wider screen (1 = never crop, 1.25 = up to ~20% of the width). */
  | { kind: "crop"; iw: number; ih: number; rect: Rect; boost: number }
  /** Let the embed fill the whole viewport itself (YouTube adapts to any size). */
  | { kind: "fill" };

/**
 * `aspect` = video height / width, when known (Instagram reports it in its embed page).
 * The Instagram media box is 540x674 (4:5) under a 54px header. A video at least that tall fills the box's height
 * and is centred with side bars, so its width is 674/aspect. Anything wider/shorter than 4:5 (square, landscape)
 * sits in a box we can't predict, so those are shown whole rather than guessed at.
 */
export function layoutFor(platform: string, embedUrl: string, aspect?: number): Layout {
  if (platform === "instagram") {
    const BOX_H = 674;
    const a = aspect && aspect > 0 ? aspect : /\/reel\//.test(embedUrl) ? 16 / 9 : 0; // unknown reel: assume 9:16
    if (a >= 1.24) {
      const w = Math.min(540, BOX_H / a);
      return { kind: "crop", iw: 540, ih: 1000, rect: { x: (540 - w) / 2, y: 54, w, h: BOX_H }, boost: a >= 1.7 ? 1.25 : 1 };
    }
    return { kind: "crop", iw: 540, ih: 1000, rect: { x: 0, y: 0, w: 540, h: 1000 }, boost: 1 };
  }
  if (platform === "tiktok") {
    // 3px inset hides the card's rounded corners. Small boost: the like/comment/share buttons sit near the edge.
    return { kind: "crop", iw: 325, ih: 580, rect: { x: 3, y: 3, w: 319, h: 572 }, boost: 1.12 };
  }
  if (platform === "facebook") {
    // The plugin renders a 9:16 player (500x889 at width=500). Reels fill it edge to edge; the Share button
    // sits ~25px from the right edge, so don't crop more than ~1.22x (it still fills a tall phone).
    // Facebook gives no hint about orientation, so only links that came in as /reel/ get the crop-to-fill boost;
    // watch/videos links are shown whole (a landscape video then simply sits letterboxed).
    const isReel = /reel(%2F|\/)/i.test(embedUrl);
    return { kind: "crop", iw: 500, ih: 889, rect: { x: 0, y: 0, w: 500, h: 889 }, boost: isReel ? 1.22 : 1 };
  }
  if (platform === "youtube") {
    // In a portrait iframe the embed switches to the Shorts-style player (Shorts logo, like/share rail on the
    // right edge), so render it 9:16 and scale it up. Same fill as Instagram; the rail and title can lose a few px at the edges.
    return { kind: "crop", iw: 360, ih: 640, rect: { x: 0, y: 0, w: 360, h: 640 }, boost: 1.22 };
  }
  return { kind: "fill" };
}

export type Placed = {
  /** the crop window, in viewport px */
  box: { left: number; top: number; width: number; height: number };
  /** the iframe inside the crop window */
  frame: { left: number; top: number; width: number; height: number; scale: number };
};

/** Where to put the crop window and the iframe for a given viewport. */
export function place(layout: Layout, vw: number, vh: number): Placed {
  if (layout.kind === "fill") {
    return { box: { left: 0, top: 0, width: vw, height: vh }, frame: { left: 0, top: 0, width: vw, height: vh, scale: 1 } };
  }
  const { iw, ih, rect, boost } = layout;
  const contain = Math.min(vw / rect.w, vh / rect.h);
  const cover = Math.max(vw / rect.w, vh / rect.h);
  const s = contain * Math.min(cover / contain, boost);
  const w = rect.w * s;
  const h = rect.h * s;
  return {
    box: { left: (vw - w) / 2, top: (vh - h) / 2, width: w, height: h },
    frame: { left: -rect.x * s, top: -rect.y * s, width: iw, height: ih, scale: s },
  };
}
