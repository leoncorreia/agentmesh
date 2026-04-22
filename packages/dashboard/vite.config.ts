import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.DASHBOARD_PORT ?? 5173),
    proxy: {
      '/gql': { target: 'http://localhost:9991', changeOrigin: true },
      '/core': { target: 'http://localhost:3000', changeOrigin: true },
      '/voice': {
        target: 'http://localhost:3004',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/voice/, ''),
      },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
