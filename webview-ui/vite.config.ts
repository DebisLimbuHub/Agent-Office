import react from '@vitejs/plugin-react';
import * as path from 'path';
import { defineConfig } from 'vite';

import { browserMockAssetsPlugin } from '../shared/assets/plugin.js';

export default defineConfig({
  plugins: [
    react(),
    browserMockAssetsPlugin({
      assetsDir: path.resolve(__dirname, 'public/assets'),
      distAssetsDir: path.resolve(__dirname, '../dist/webview/assets'),
    }),
  ],
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
  },
  base: './',
});
