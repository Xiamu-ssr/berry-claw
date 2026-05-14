import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'renderer/dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 3211,
    proxy: {
      '/api': 'http://localhost:3210',
      '/ws': {
        target: 'ws://localhost:3210',
        ws: true,
      },
    },
  },
});
