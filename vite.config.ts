import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Chemins relatifs : le site fonctionne tel quel sur GitHub Pages.
  base: './',
  resolve: { dedupe: ['three'] },
  build: { chunkSizeWarningLimit: 2500 },
  test: { include: ['src/**/*.test.ts'] },
});
