import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` is a native-ish driver that must stay on the Node runtime rather than
  // being bundled into server components output.
  serverExternalPackages: ["pg"],

  images: {
    // Company logos on the Dashboard come from Logo.dev's CDN (ADR 0011).
    // `CompanyIcon` loads them straight from here with a custom loader rather
    // than through the Vercel image optimizer; this entry is the backstop that
    // keeps them working if that loader is ever removed.
    remotePatterns: [{ protocol: "https", hostname: "img.logo.dev" }],
  },
};

export default nextConfig;
