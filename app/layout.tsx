import type { Metadata, Viewport } from "next";
import { Fredoka, Nunito } from "next/font/google";
import Providers from "@/components/Providers";
import "./globals.css";

const display = Fredoka({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const bodyFont = Nunito({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Open the Box 📦",
  description: "Team video party game — send in videos, rate them, guess who sent them.",
};
// No maximumScale: pinch-to-zoom stays available (a fixed max scale is an accessibility anti-pattern —
// some players genuinely need to zoom in to read small text).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#1B0F3B" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${bodyFont.variable}`}>
      <head>
        {/* start the TLS handshakes early so the first embed of a game doesn't pay for a cold connection */}
        <link rel="preconnect" href="https://www.instagram.com" />
        <link rel="preconnect" href="https://www.tiktok.com" />
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://www.facebook.com" />
        <link rel="dns-prefetch" href="https://scontent.cdninstagram.com" />
        <link rel="dns-prefetch" href="https://i.ytimg.com" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
