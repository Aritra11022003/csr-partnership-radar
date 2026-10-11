/** @type {import('next').NextConfig} */
const nextConfig = {
  // Seed + prompt files are read from disk at run time; make sure Vercel bundles them.
  outputFileTracingIncludes: {
    "/api/**": ["./seed/**", "./prompts/**"],
    "/**": ["./seed/**"],
  },
  serverExternalPackages: ["rss-parser"],
};
export default nextConfig;
