import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rolldownOptions: {
      // Each HTML file is a separate page, loaded into its own window.
      input: {
        main: 'index.html',
        portrait: 'portrait.html',
      },
    },
  },
});
