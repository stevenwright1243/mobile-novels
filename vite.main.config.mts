import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    // `rollupOptions` (not the newer `rolldownOptions`) so this list merges
    // with the one Forge's Vite plugin sets under the same key.
    rollupOptions: {
      // Native modules can't be bundled, so load them from node_modules at
      // runtime instead.
      external: ['koffi'],
    },
  },
});
