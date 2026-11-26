// Start the TLS handshakes for the video sites early, so the first embed of a game doesn't pay for a cold
// connection. Scoped to this route (the only one that ever loads a video embed) instead of the root layout.
// Next.js hoists <link> tags rendered anywhere in the tree into the document <head>.
export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://www.instagram.com" />
      <link rel="preconnect" href="https://www.tiktok.com" />
      <link rel="preconnect" href="https://www.youtube.com" />
      <link rel="preconnect" href="https://www.facebook.com" />
      <link rel="dns-prefetch" href="https://scontent.cdninstagram.com" />
      <link rel="dns-prefetch" href="https://i.ytimg.com" />
      {children}
    </>
  );
}
