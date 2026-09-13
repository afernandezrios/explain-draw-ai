/** @type {import('next').NextConfig} */
const nextConfig = {
  // Remotion's renderer/bundler must stay outside the Next server bundle: they
  // spawn child processes and resolve native binaries from their own directory.
  serverExternalPackages: ['@remotion/renderer', '@remotion/bundler'],
};

module.exports = nextConfig;
