module.exports = ({
  mode, base, root, cacheDir, manifestRelPath, sourceMaps
}) => {
  /** @type {import('vite').UserConfig} */
  const config = {
    mode,
    // We might need to utilize the advanced asset settings here.
    // https://vite.dev/guide/build.html#advanced-base-options
    // For now we just use the (real) asset base URL.
    base,
    root,
    appType: 'custom',
    publicDir: false,
    cacheDir,
    clearScreen: false,
    // Breaks symlinked modules if not enabled
    resolve: {
      preserveSymlinks: true
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
          silenceDeprecations: [ 'import' ]
        }
      }
    },
    plugins: [],
    build: {
      outDir: 'dist',
      cssCodeSplit: true,
      manifest: manifestRelPath,
      sourcemap: sourceMaps,
      emptyOutDir: false,
      assetDir: 'assets',
      rollupOptions: {
        output: {
          entryFileNames: '[name]-build.js'
        }
      }
    }
  };

  return config;
};
