const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.externals['@solana/kit'] = 'commonjs @solana/kit';
    config.externals['@solana-program/memo'] = 'commonjs @solana-program/memo';
    config.externals['@solana-program/system'] = 'commonjs @solana-program/system';
    config.externals['@solana-program/token'] = 'commonjs @solana-program/token';
    config.externals['@solana-program/associated-token'] = 'commonjs @solana-program/associated-token';
    return config;
  },
  turbopack: {}
};

export default nextConfig;
