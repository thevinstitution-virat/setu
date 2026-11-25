import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // 3D icons never change under the same name (a redrawn icon gets a new file name).
      { source: "/icons3d/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
  // Invoice PDFs read Geist TTFs from assets/fonts at runtime; keep them in traced output.
  outputFileTracingIncludes: {
    "/api/invoices/*": ["./assets/fonts/**"],
    "/api/public/invoices/*": ["./assets/fonts/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
