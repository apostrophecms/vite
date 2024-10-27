module.exports = async ({
  app, httpServer, hasHMR, hmrPort
}) => {

  /** @type {import('vite').UserConfig} */
  const config = {
    base: '/__vite',
    server: {
      middlewareMode: {
        server: app
      },
      hmr: hasHMR
        ? {
          server: httpServer,
          port: hmrPort
        }
        : false
    }
  };

  if (!hasHMR) {
    config.server.watch = null;
  }

  return config;
};
