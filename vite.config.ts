import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'frontend/src'),
      '@contracts': resolve(__dirname, 'contracts')
    }
  },
  base: './',
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        pet: resolve(__dirname, 'pet.html'),
        chat: resolve(__dirname, 'chat.html'),
        notch: resolve(__dirname, 'notch.html')
      }
    }
  }
});
