import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import path from 'path';

export default defineConfig({
  plugins: [react(), wasm()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    // sql.js ships a WASM binary — exclude from pre-bundling
    exclude: ['sql.js'],
  },
  worker: {
    format: 'es',
    plugins: () => [wasm()],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          onnx: ['onnxruntime-web'],
          charts: ['recharts'],
          sqljs: ['sql.js'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
  },
});
