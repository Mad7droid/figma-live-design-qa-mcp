import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Source uses NodeNext-style `./foo.js` specifiers. Map them back to the `.ts` files so
 * tests can import the real modules without a build step.
 */
function nodeNextResolver(): Plugin {
  return {
    name: 'nodenext-js-to-ts',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
      const candidate = resolve(dirname(importer), source.replace(/\.js$/, '.ts'));
      return existsSync(candidate) ? candidate : null;
    },
  };
}

export default defineConfig({
  plugins: [nodeNextResolver()],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
