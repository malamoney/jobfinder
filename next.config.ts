import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` is a native-ish driver that must stay on the Node runtime rather than
  // being bundled into server components output.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
