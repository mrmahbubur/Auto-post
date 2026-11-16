import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig, type Plugin} from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function stripGhRootFallback(): Plugin {
  return {
    name: 'strip-gh-root-fallback',
    transformIndexHtml(html) {
      return html
        .replace(/\s*onerror="window\.__loadStaticApp && window\.__loadStaticApp\(\)"/g, '')
        .replace(/<!-- gh-root-fallback:start -->[\s\S]*?<!-- gh-root-fallback:end -->\s*/g, '');
    },
  };
}

export default defineConfig(({mode}) => {
  const isGhPages = mode === 'ghpages';
  return {
    base: './',
    plugins: [react(), tailwindcss(), stripGhRootFallback()],
    resolve: {
      alias: {
        '@': __dirname,
      },
    },
    ...(isGhPages
      ? {
          build: {
            outDir: 'static-app',
            emptyOutDir: true,
            rolldownOptions: {
              output: {
                entryFileNames: 'app.js',
                chunkFileNames: 'app-[name].js',
                assetFileNames: (assetInfo: {names?: string[]; name?: string}) => {
                  const fname = assetInfo.names?.[0] || assetInfo.name || '';
                  return fname.endsWith('.css') ? 'app.css' : 'asset-[name][extname]';
                },
              },
            },
          },
        }
      : {}),
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
