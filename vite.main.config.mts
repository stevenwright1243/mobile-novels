import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    // `rollupOptions` (not the newer `rolldownOptions`) so this list merges
    // with the one Forge's Vite plugin sets under the same key.
    rollupOptions: {
      // Load these from node_modules at runtime instead of bundling them:
      // koffi is a native module, and tesseract.js starts its worker thread
      // from a script file found by path.
      external: ['koffi', 'tesseract.js'],
    },
  },
});
