import { randomBytes } from "crypto";

export function randomToken(bytes = 18) {
  return randomBytes(bytes).toString("base64url");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O
export function roomCode() {
  const b = randomBytes(4);
  return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

export const AVATAR_COLORS = ["#FF4FA3", "#FFD23F", "#3DDC97", "#FF8A3D", "#3FC1FF", "#B07CFF", "#FF5E5E", "#7CF5FF", "#C6FF4F", "#FFA8E0"];

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32BE(0) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
