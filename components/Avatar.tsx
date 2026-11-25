export default function Avatar({ name, color, size = 48, dim, ring }: { name?: string | null; color?: string | null; size?: number; dim?: boolean; ring?: boolean }) {
  const initials = (name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full border-4 border-night font-display font-bold text-night transition ${dim ? "opacity-30 grayscale" : ""} ${ring ? "ring-4 ring-sunny" : ""}`}
      style={{ width: size, height: size, background: color || "#999", fontSize: size * 0.38 }}
      title={name || ""}
    >
      {initials}
    </div>
  );
}
