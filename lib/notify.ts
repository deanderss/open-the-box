/** Email the admin when someone requests moderator access. Best effort: never throws. */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const ADMIN_EMAIL = (process.env.ADMIN_NOTIFY_EMAIL || "dane.andersson.da@gmail.com").toLowerCase();

export async function sendApprovalRequestEmail(r: { name: string; email: string; ip: string; userAgent: string; origin: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set — approval email not sent (request is still in the admin panel)");
    return false;
  }
  const link = `${r.origin}/admin`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px">
      <h2>📦 New moderator request</h2>
      <p>Someone wants to be a moderator on Open the Box.</p>
      <table style="border-collapse:collapse">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Name</td><td><b>${esc(r.name)}</b></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td><b>${esc(r.email)}</b></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">IP</td><td>${esc(r.ip)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Browser</td><td>${esc(r.userAgent.slice(0, 120))}</td></tr>
      </table>
      <p><a href="${esc(link)}" style="display:inline-block;background:#FFD23F;color:#1b1030;padding:10px 18px;border-radius:12px;font-weight:bold;text-decoration:none">Review &amp; approve in the admin panel</a></p>
      <p style="color:#666;font-size:12px">They can't log in until you approve. You'll need to be logged in as admin.</p>
    </div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM || "Open the Box <onboarding@resend.dev>",
        to: [ADMIN_EMAIL],
        subject: `Moderator request: ${r.name} (${r.email})`,
        html,
      }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) console.error("approval email failed", res.status, (await res.text()).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error("approval email error", e);
    return false;
  }
}
