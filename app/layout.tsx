import type { Metadata, Viewport } from "next";
import { Fredoka, Nunito } from "next/font/google";
import Providers from "@/components/Providers";
import "./globals.css";

// No `weight` array: both families ship a variable font on Google Fonts, so next/font loads one file
// covering every weight instead of a separate static file per weight used across the app.
const display = Fredoka({ subsets: ["latin"], variable: "--font-display" });
const bodyFont = Nunito({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Open the Box 📦",
  description: "Team video party game — send in videos, rate them, guess who sent them.",
};
// No maximumScale: pinch-to-zoom stays available (a fixed max scale is an accessibility anti-pattern —
// some players genuinely need to zoom in to read small text).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#1B0F3B" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page on every route eventually talks to Supabase (auth check at minimum), so this preconnect
  // belongs at the root. The video-site preconnects below are specific to the one route that ever embeds a
  // video — see app/g/[groupId]/play/layout.tsx.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return (
    <html lang="en" className={`${display.variable} ${bodyFont.variable}`}>
      <head>{supabaseUrl && <link rel="preconnect" href={supabaseUrl} />}</head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
