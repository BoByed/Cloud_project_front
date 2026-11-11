import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

declare const process: { env: Record<string, string | undefined> };

const backendTarget = process.env.BACKEND_URL || 'http://localhost:8080';
const wsTarget = backendTarget.replace(/^http/, 'ws');

// Helper to attach X-Local-Test-User-ID header from cookie if not explicitly set
function attachLocalUserHeader(proxy: any) {
  proxy.on('proxyReq', (proxyReq: any, req: any) => {
    if (!proxyReq.getHeader('x-local-test-user-id')) {
      const cookieHeader = req.headers?.cookie;
      if (cookieHeader) {
        const match = cookieHeader.match(/local_test_user_id=([^;]+)/);
        if (match) {
          proxyReq.setHeader('X-Local-Test-User-ID', decodeURIComponent(match[1].trim()));
        }
      }
    }
  });

  proxy.on('proxyReqWs', (proxyReq: any, req: any) => {
    if (!proxyReq.getHeader('x-local-test-user-id')) {
      const cookieHeader = req.headers?.cookie;
      if (cookieHeader) {
        const match = cookieHeader.match(/local_test_user_id=([^;]+)/);
        if (match) {
          proxyReq.setHeader('X-Local-Test-User-ID', decodeURIComponent(match[1].trim()));
        }
      }
    }
  });
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/v1/ws': {
        target: wsTarget,
        ws: true,
        changeOrigin: false,
        configure: attachLocalUserHeader
      },
      '/api': {
        target: backendTarget,
        changeOrigin: false,
        configure: attachLocalUserHeader
      },
      '/auth': {
        target: backendTarget,
        changeOrigin: false,
        configure: attachLocalUserHeader
      },
      '/health': {
        target: backendTarget,
        changeOrigin: false,
        configure: attachLocalUserHeader
      }
    }
  }
});
