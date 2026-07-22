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
      solidstore: resolve(__dirname, '../../src'),
    },
  },
});
