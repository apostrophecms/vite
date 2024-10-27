import path from 'path';

export default function VitePluginApos({ sourceRoot }) {
  return {
    name: 'vite-plugin-apostrophe',
    async resolveId(source, importer, options) {
      if (!source.startsWith('Modules/')) {
        return null;
      }
      const chunks = source.replace('Modules/', '').split('/');
      let moduleName = chunks.shift();
      if (moduleName.startsWith('@')) {
        moduleName += '/' + chunks.shift();
      }
      const resolved = await this.resolve(
        path.join(sourceRoot, moduleName, 'apos', ...chunks),
        importer,
        options
      );
      if (!resolved) {
        console.error('APOS MODULE RESOLVE FAILED!',
          'FROM: ' + source,
          'TO: ' + path.join(sourceRoot, moduleName, 'apos', ...chunks)
        );
      }
      return resolved;
    }
  };
}
