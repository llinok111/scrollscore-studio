import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// The upstream AOS sources live one directory above this project, so Node module
// resolution from there would never reach studio/node_modules. Pin the two
// upstream runtime deps explicitly.
const upstreamDeps = {
  'lodash.throttle': require.resolve('lodash.throttle'),
  'lodash.debounce': require.resolve('lodash.debounce')
};

// The studio lives one level below the repository root so that the upstream AOS
// sources (src/js, src/sass) can be imported unmodified.
export default defineConfig({
  // Pages serves this project from /<repo>/, so the base must stay injectable.
  base: process.env.BASE_PATH || '/',
  resolve: {
    alias: {
      ...upstreamDeps,
      '@scrub': fileURLToPath(new URL('../src/js/scrub', import.meta.url)),
      '@aos': fileURLToPath(new URL('../src/js/aos.js', import.meta.url)),
      '@upstream-sass': fileURLToPath(new URL('../src/sass', import.meta.url)),
      '@studio': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 4180,
    strictPort: true
  },
  preview: {
    port: 4180,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        // Standalone page used by the upstream-compatibility test suite.
        upstream: fileURLToPath(new URL('./upstream.html', import.meta.url))
      }
    }
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.js'],
    reporters: 'default'
  }
});
