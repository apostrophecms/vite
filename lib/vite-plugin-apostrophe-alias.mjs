import { join } from 'node:path';

/**
 * Resolve `apos` and `public` builds alias `Modules/`. The `sourceRoot` option
 * should be the absolute path to `apos-build/.../src` folder.
 * The `id` option should be either `apos` or `src` depending on the build it's
 * being used for (apos or public respectively).
 *
 * @param {{ id: 'src' | 'apos', sourceRoot: string }} options
 * @returns {import('vite').Plugin}
 */
export default function VitePluginApos({ sourceRoot, id } = {}) {
  if (!id) {
    throw new Error('[vite-plugin-apostrophe-alias] `id` option is required.');
  }
  if (!sourceRoot) {
    throw new Error(
      '[vite-plugin-apostrophe-alias] `sourceRoot` option is required.'
    );
  }
  const pluginOptions = {
    id,
    sourceRoot
  };

  return {
    name: 'vite-plugin-apostrophe-alias',

    async resolveId(source, importer, options) {
      if (!source.startsWith('Modules/')) {
        return null;
      }
      const chunks = source.replace('Modules/', '').split('/');
      let moduleName = chunks.shift();
      if (moduleName.startsWith('@')) {
        moduleName += '/' + chunks.shift();
      }
      const absPath = join(
        pluginOptions.sourceRoot,
        moduleName,
        pluginOptions.id,
        ...chunks
      );
      const resolved = await this.resolve(
        absPath,
        importer,
        options
      );
      if (!resolved) {
        // For internal debugging purposes
        this.warn(
          `Resolve attempt failed: "${source}" -> "${absPath}"`
        );
        // For user-facing error messages
        this.error(
          `Unable to resolve module source "${moduleName}/ui/${id}/${join(...chunks)}" ` +
          `from alias "${source}".\n` +
          'Please be sure to use the correct alias path. ' +
          'For more information, see:\n' +
          'https://docs.apostrophecms.org/guide/vite.html#resolve-alias-errors'
        );
      }
      return resolved;
    }
  };
}
