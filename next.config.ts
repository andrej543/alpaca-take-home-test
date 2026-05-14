import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Ensure SQLite + generated JSON/text ship with the Node runtime on Vercel (not inferred from static imports).
  outputFileTracingIncludes: {
    "/api/chat": [
      "./data/pm.sqlite",
      "./data/data-summary.json",
      "./data/data-faq.json",
      "./data/website-content.txt",
    ],
  },
};

export default nextConfig;
