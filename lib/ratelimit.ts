// Best-effort in-memory rate limiter (per serverless instance).
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 5000) {
      buckets.forEach((v, k) => {
        if (v.reset < now) buckets.delete(k);
      });
    }
    return true;
  }
  b.count++;
  return b.count <= limit;
}

export function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
