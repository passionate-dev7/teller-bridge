import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react()],
  define: { global: 'globalThis' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1800 },
  // the desk this build pins: deployments.json, or the file named by DEPLOYMENTS_FILE (local rehearsals)
  resolve: { alias: { buffer: 'buffer/', 'pinned-deployments': process.env.DEPLOYMENTS_FILE || fileURLToPath(new URL('../deployments.json', import.meta.url)) } },
});
