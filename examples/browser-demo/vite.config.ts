import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { resolve } from 'path';

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 5174,
  },
  resolve: {
    alias: {
      '@adsq/solid-signal-store': resolve(__dirname, '../../src'),
    },
  },
});
