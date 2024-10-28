module.exports = async ({
  sourceRoot, input
}) => {
  const vue = await import('@vitejs/plugin-vue');
  const apos = await import('./vite-plugin-apostrophe-apos.mjs');

  /** @type {import('vite').UserConfig} */
  return {
    css: {
      preprocessorOptions: {
        scss: {
          // Hardcoded for now, we need to make it configurable in the future.
          additionalData: `@use 'sass:math';
@import "${sourceRoot}/@apostrophecms/ui/apos/scss/mixins/import-all.scss";
`
        }
      }
    },
    plugins: [
      apos.default({ sourceRoot }), vue.default()
    ],
    build: {
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        input
      }
    }
  };
};