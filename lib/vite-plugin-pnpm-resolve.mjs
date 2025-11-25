import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Walk upward from a file until we find a package.json
function findPkgRoot(startFile) {
  let dir = path.dirname(startFile);
  while (true) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not find package.json above ${startFile}`);
    dir = parent;
  }
}

/**
 * Resolve transitive dependencies of specified packages. Useful when using pnpm because
 * it does not hoist dependencies to the top-level node_modules.
 *
 * @param {string[]} pkgs
 * @returns {import('vite').Plugin}
 */
export default function VitePluginPnpmResolve(pkgs = ['@apostrophecms/vite', 'apostrophe']) {
  const roots = pkgs.map((name) => findPkgRoot(require.resolve(name)));

  return {
    name: 'apos-pnpm-resolve',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // Let vite/rollup try first
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved) return resolved;

      // Ignore URLs, virtual ids, and relative paths
      if (!/^[\w@][^:]*$/.test(source) || source.startsWith('.') || source.startsWith('/')) {
        return null;
      }

      // Fallback: resolve as if from each package's install dir
      for (const root of roots) {
        try {
          const id = require.resolve(source, { paths: [root] });
          return id;
        } catch { /* continue */ }
      }
      return null;
    }
  };
}
