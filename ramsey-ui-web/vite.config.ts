import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'target/classes/META-INF/resources',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8501',
      '/ws': { target: 'ws://localhost:8501', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
