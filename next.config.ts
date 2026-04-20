import type { NextConfig } from 'next';

const corsHeaders = [
  { key: 'Access-Control-Allow-Origin', value: '*' },
  { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
  { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
];

const cspHeader = {
  key: 'Content-Security-Policy',
  value: 'frame-ancestors *',
};

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
  async headers() {
    return [
      {
        // 所有路径：允许 iframe 嵌入
        source: '/:path*',
        headers: [cspHeader],
      },
      {
        // SaaS 代理接口：全开放 CORS
        source: '/api/tool/:path*',
        headers: corsHeaders,
      },
    ];
  },
};

export default nextConfig;
