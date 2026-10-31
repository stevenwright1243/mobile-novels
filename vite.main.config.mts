import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    // `rollupOptions` (not the newer `rolldownOptions`) so this list merges
    // with the one Forge's Vite plugin sets under the same key.
    rollupOptions: {
      // Load koffi from node_modules at runtime instead of bundling it,
      // since it's a native module.
      external: ['koffi'],
    },
  },
});
