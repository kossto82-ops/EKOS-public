import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      // These parsers are only reached via dynamic import() in
      // src/utils/extractFileText.ts (upload flow). Pre-bundling them at
      // startup stops Vite from discovering them mid-session and triggering a
      // dep re-optimization + reload — which otherwise makes the dynamic
      // import fail with "Failed to fetch dynamically imported module".
      include: ['mammoth', 'pdfjs-dist', 'xlsx'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      target: 'es2020',
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-markdown': ['react-markdown'],
            'vendor-icons': ['lucide-react'],
            // Heavy document parsers, only reached via dynamic import() in
            // src/utils/extractFileText.ts on the upload flow. Named here so
            // they show up as clearly-labelled on-demand vendor chunks rather
            // than an anonymous "index-*" chunk in the build output.
            'vendor-pdf': ['pdfjs-dist'],
            'vendor-xlsx': ['xlsx'],
            'vendor-docx': ['mammoth'],
          },
          assetFileNames: 'assets/[name]-[hash][extname]',
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
        },
      },
    },
  };
});
