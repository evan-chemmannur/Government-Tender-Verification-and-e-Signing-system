import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
      '/auth': 'http://localhost:3001'
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.js', 'tests/**/*.test.jsx', 'src/tests/**/*.test.jsx', 'src/tests/**/*.test.js'],
    setupFiles: ['./vitest.setup.js'],
    deps: {
      // Allow pako and other CJS deps to be transformed
      interopDefault: true
    }
  }
});
