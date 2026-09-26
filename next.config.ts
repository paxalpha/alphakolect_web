import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  webpack: (config, { dev, isServer }) => {
    // Limit webpack cache size to prevent memory issues
    if (dev) {
      config.cache = {
        type: 'filesystem',
        maxMemoryGenerations: 1,
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        buildDependencies: {
          config: [__filename],
        },
      };
    }
    return config;
  },
  // Increase memory limit for Node.js
  experimental: {
    // Reduce memory usage during build
    memoryBasedWorkersCount: true,
  },
};

export default nextConfig;
