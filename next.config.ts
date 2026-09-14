import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    '*': [
      'backups/**/*',
      'uploads/**/*',
      'database.db',
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  async rewrites() {
    // beforeFiles: attachments must ALWAYS go through the authenticated route.
    // A plain array means afterFiles, which runs after static files in public/
    // are served — so a file sitting in public/uploads would bypass sign-in.
    return {
      beforeFiles: [
        {
          source: '/uploads/:path*',
          destination: '/api/uploads/:path*',
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
