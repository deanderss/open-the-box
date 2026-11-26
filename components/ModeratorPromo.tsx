/** A small "become a moderator" ad shown on the player phone page — pushes the game's growth loop
 * (players who enjoy the game can start their own box with their own friends). Hidden while someone
 * is actively rating/guessing a video so it can't be mis-tapped, but visible on every other screen. */
export default function ModeratorPromo() {
  return (
    <div className="card mt-auto text-center">
      <p className="font-display text-lg">Want your own game night?</p>
      <p className="mt-1 text-sm text-white/70">Become a moderator: create boxes and invite your own friends to play.</p>
      <a href="/login?mode=signup" target="_blank" rel="noopener noreferrer" className="btn btn-pink mt-3 inline-block w-full">
        Become a moderator
      </a>
    </div>
  );
}
