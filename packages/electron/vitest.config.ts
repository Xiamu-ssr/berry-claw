import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['renderer/src/**/__tests__/*.test.ts', 'renderer/src/**/*.test.ts'],
    globals: false,
  },
});
