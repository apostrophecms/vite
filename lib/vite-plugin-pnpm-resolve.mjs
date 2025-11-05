import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Resolve transitive dependencies of specified packages. Useful when using pnpm because
 * it does not hoist dependencies to the top-level node_modules.
 *
 * @param {object} options
 * @param {string[]} [options.pkgs] Package names to search dependencies from
 * @param {string} [options.projectRoot] The Vite project root directory
 * @returns {import('vite').Plugin}
 */
export default function VitePluginPnpmResolve({
  pkgs = [ '@apostrophecms/vite', 'apostrophe' ],
  projectRoot = process.cwd()
} = {}) {
  if (!pkgs?.length) {
    return {
      name: 'apos-pnpm-resolve',
      enforce: 'pre'
    };
  }
  const roots = computePkgRoots(pkgs, projectRoot);

  return {
    name: 'apos-pnpm-resolve',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // Let vite/rollup try first
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true
      });
      if (resolved) {
        return resolved;
      }

      if (
        source.startsWith('Modules/') ||
        source.startsWith('@/') ||
        source.startsWith('.') ||
        source.startsWith('/')) {
        return null;
      }

      // Ignore URLs, virtual ids, and relative paths
      if (!/^[\w@][^:]*$/.test(source)) {
        return null;
      }

      // Fallback: resolve as if from each package's install dir
      for (const root of roots) {
        try {
          const id = require.resolve(source, {
            paths: [ root ]
          });
          return id;
        } catch {
          // Continue to next root
        }
      }
      return null;
    }
  };
}

function computePkgRoots(pkgs, projectRoot) {
  const roots = [];

  const workspaceRoot = findWorkspaceRoot(projectRoot);
  if (workspaceRoot) {
    roots.push(workspaceRoot);
  }
  roots.push(projectRoot);

  // Build list of package roots with name validation, skipping any that fail
  for (const name of pkgs) {
    try {
      const resolved = require.resolve(name, {
        paths: [ projectRoot ]
      });
      const root = findPkgRoot(resolved, name);
      if (root && !roots.includes(root)) {
        roots.push(root);

        const pkgWorkspaceRoot = findWorkspaceRoot(root);
        if (pkgWorkspaceRoot) {
          roots.push(pkgWorkspaceRoot);
        }
      }
    } catch {
      // skip it
    }
  }

  return [ ...new Set(roots) ];
}

// Walk upward from a file until we find a package.json
function findPkgRoot(startFile, expectedName) {
  try {
    // Resolve symlinks to get the real path
    let dir = path.dirname(fs.realpathSync(startFile));

    while (true) {
      const pkg = path.join(dir, 'package.json');

      if (fs.existsSync(pkg)) {
        // Validate the package name matches
        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkg, 'utf8'));
          if (pkgJson.name === expectedName) {
            return dir;
          }
        } catch {
          // continue searching
        }
      }

      const parent = path.dirname(dir);
      // Check if we've reached the filesystem root
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  } catch (err) {
    return null;
  }
}

// pnpm workspace support
function findWorkspaceRoot(startDir) {
  let dir = startDir;

  while (true) {
    const workspaceFile = path.join(dir, 'pnpm-workspace.yaml');
    const lockFile = path.join(dir, 'pnpm-lock.yaml');
    if (fs.existsSync(workspaceFile) || fs.existsSync(lockFile)) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
