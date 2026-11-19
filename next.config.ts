import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
