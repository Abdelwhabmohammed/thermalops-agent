import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standard output — deploy with `npm run build && npm start` (or Azure's
  // SCM_DO_BUILD_DURING_DEPLOYMENT + `npx next start -p 8080`).
  reactStrictMode: false, // Leaflet double-mount guard in dev
  serverExternalPackages: ["node-cron"], // background scheduler runs in Node runtime only
};

export default nextConfig;
