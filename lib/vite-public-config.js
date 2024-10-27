module.exports = async ({
  input
}) => {

  /** @type {import('vite').UserConfig} */
  return {
    build: {
      rollupOptions: {
        input
      }
    }
  };
};
