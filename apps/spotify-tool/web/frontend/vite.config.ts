import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['spotcl.ryantaylor.tech', 'localhost', '10.0.1.161'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true
      }
    }
  }
});