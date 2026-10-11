import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; set by the deploy workflow.
  base: process.env.PAGES_BASE ?? '/',
  plugins: [react()],
  server: { port: 5173, allowedHosts: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    // artifact hosting inlines one script into the page
    rollupOptions: process.env.ARTIFACT ? { output: { inlineDynamicImports: true } } : undefined,
  },
});
