/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No other site may frame the app (clickjacking the host controls), and browsers must not guess file types.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};
export default nextConfig;
