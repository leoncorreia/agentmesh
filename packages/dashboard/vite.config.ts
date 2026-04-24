import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const coreTarget = process.env.VITE_CORE_URL ?? 'http://localhost:3000';
const gatewayTarget = process.env.VITE_GATEWAY_URL ?? 'http://localhost:9991';
const voiceTarget = process.env.VITE_VOICE_URL ?? 'http://localhost:3004';
const coreWsTarget = process.env.VITE_CORE_WS_URL ?? 'ws://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.DASHBOARD_PORT ?? 5173),
    proxy: {
      '/gql': { target: gatewayTarget, changeOrigin: true },
      '/core': { target: coreTarget, changeOrigin: true },
      '/voice': {
        target: voiceTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/voice/, ''),
      },
      '/ws': { target: coreWsTarget, ws: true },
    },
  },
});
