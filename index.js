const path = require('node:path');
const fs = require('fs-extra');
module.exports = {
  before: '@apostrophecms/asset',
  i18n: {
    aposVite: {}
  },
  async init(self) {
    self.buildSourceFolderName = 'src';
    self.distFolderName = 'dist';
    self.buildRoot = null;
    self.buildRootSource = null;
    self.distRoot = null;
    self.buildManifestPath = null;

    // Cached metadata for the current run
    self.currentSourceMeta = null;
    self.entrypointsManifest = [];

    // Populated after a build has been triggered
    self.buildOptions = null;
    self.viteDevMiddleware = null;
    self.shouldCreateDevServer = false;

    // Populated when a watch is triggered
    // all UI folders -> index
    self.currentSourceUiIndex = {};
    // all path -> index
    self.currentSourceFsIndex = {};
    // relative/path/file -> [ index1, index2 ]
    self.currentSourceRelIndex = new Map();
    // Modules/moduleName/ -> index
    self.currentSourceAliasIndex = {};

    // IMPORTANT: This should not be removed.
    // Vite depends on both process.env.NODE_ENV and the `mode` config option.
    // They should be in sync and ALWAYS set. We need to patch the environment
    // and ensure it's set here.
    // Read more at https://vite.dev/guide/env-and-mode.html#node-env-and-modes
    if (!process.env.NODE_ENV) {
      process.env.NODE_ENV = 'development';
    }
  },

  handlers(self) {
    return {
      '@apostrophecms/asset:afterInit': {
        async registerExternalBuild() {
          self.apos.asset.configureBuildModule(self, {
            alias: 'vite',
            devServer: true,
            hmr: true
          });
          await self.initWhenReady();
        }
      },
      '@apostrophecms/express:afterListen': {
        async prepareViteDevServer() {
          if (self.shouldCreateDevServer) {
            await self.createViteInstance(self.buildOptions);
          }
        }
      }
    };
  },

  middleware(self) {
    if (process.env.NODE_ENV === 'production') {
      return {};
    }
    return {
      viteDevServer: {
        before: '@apostrophecms/express',
        url: '/__vite',
        middleware: async (req, res, next) => {
          if (!self.shouldCreateDevServer) {
            return next();
          }
          // Do not provide `next` to the middleware, we want to stop the chain here
          // if the request is handled by Vite. It provides its own 404 handler.
          self.viteDevMiddleware(req, res);
        }
      }
    };
  },

  methods(self) {
    return {
      async build(options = {}) {
        self.buildOptions = options;
        await self.buildBefore(options);

        const { build, config } = await self.getViteBuild(options);
        await build(config);

        const viteManifest = await self.getViteBuildManifest();
        self.entrypointsManifest = await self.applyManifest(self.entrypointsManifest, viteManifest);
        return {
          entrypoints: self.entrypointsManifest,
          sourceMapsRoot: self.distRoot
        };
      },
      async startDevServer(options) {
        self.buildOptions = options;
        self.shouldCreateDevServer = true;
        await self.buildBefore(options);

        const devServerUrl = self.getDevServerUrl();
        self.entrypointsManifest.unshift({
          name: 'vite',
          type: 'bundled',
          scenes: [ 'public' ],
          outputs: [ 'js' ],
          manifest: {
            root: '',
            files: {},
            src: {
              js: [ '@vite/client' ]
            },
            devServerUrl
          }
        });
        return {
          entrypoints: self.entrypointsManifest,
          devServerUrl
        };
      },
      // Initialize the watcher for triggering vite HMR via file
      // copy to the build source.
      // `chokidar` is a chockidar `FSWatcher` or compatible instance.
      async watch(chokidar) {
        self.buildWatchIndex();
        chokidar
          .on('add', (p) => self.onSourceAdd(p, false))
          .on('addDir', (p) => self.onSourceAdd(p, true))
          .on('change', self.onSourceChange)
          .on('unlink', (p) => self.onSourceUnlink(p, false))
          .on('unlinkDir', (p) => self.onSourceUnlink(p, true));
      },
      buildWatchIndex() {
        self.currentSourceMeta.forEach((entry, index) => {
          self.currentSourceUiIndex[entry.dirname] = index;
          entry.files.forEach((file) => {
            self.currentSourceFsIndex[path.join(entry.dirname, file)] = index;
            self.currentSourceRelIndex.set(
              file,
              (self.currentSourceRelIndex.get(file) ?? new Set())
                .add(index)
            );
          });
          self.currentSourceAliasIndex[entry.importAlias] = index;
        });
      },
      onSourceAdd(filePath, isDir) {
        if (isDir) {
          return;
        }
        const p = path.join(self.apos.rootDir, filePath);
        const key = Object.keys(self.currentSourceUiIndex)
          .filter((dir) => p.startsWith(dir))
          .reduce((acc, dir) => {
            // Choose the best match - the longest string wins
            if (dir.length > acc.length) {
              return dir;
            }
            return acc;
          }, '');
        const index = self.currentSourceUiIndex[key];
        const entry = self.currentSourceMeta[index];

        if (!entry) {
          return;
        }
        const file = p.replace(entry.dirname + '/', '');
        entry.files.push(file);
        entry.files = Array.from(new Set(entry.files));

        // Add the new file to the absolute and relative index
        self.currentSourceRelIndex.set(
          file,
          (self.currentSourceRelIndex.get(file) ?? new Set())
            .add(index)
        );
        self.currentSourceFsIndex[p] = index;

        // The actual trigger.
        self.onSourceChange(filePath);

        // TODO: we can do in-process recalculations to regenerate the import files
        // when required in the future. It would require a more complex detection
        // per "current entrypoints" similar to what we are doing in the build process
        // when we generate the import files.
      },
      onSourceChange(filePath, silent = false) {
        const p = path.join(self.apos.rootDir, filePath);
        const source = self.currentSourceMeta[self.currentSourceFsIndex[p]]
          ?.files.find((file) => p.endsWith(file));
        if (!source) {
          return;
        }
        self.currentSourceRelIndex.get(source)?.forEach((index) => {
          try {
            const target = path.join(self.buildRootSource, self.currentSourceMeta[index].name, source);
            fs.mkdirpSync(path.dirname(target));
            fs.copyFileSync(
              path.join(self.currentSourceMeta[index].dirname, source),
              target
            );
          } catch (e) {
            if (silent) {
              return;
            }
            self.apos.util.error(
              `Failed to copy file "${source}" from module ${self.currentSourceMeta[index]?.name}`,
              e.message
            );
          }
        });

      },
      onSourceUnlink(filePath, isDir) {
        if (isDir) {
          return;
        }
        const p = path.join(self.apos.rootDir, filePath);
        const source = self.currentSourceMeta[self.currentSourceFsIndex[p]]
          ?.files.find((file) => p.endsWith(file));
        if (!source) {
          return;
        }
        const index = self.currentSourceFsIndex[p];

        // 1. Delete the source file from the build source
        fs.unlinkSync(
          path.join(
            self.buildRootSource,
            self.currentSourceMeta[index].name,
            source
          )
        );
        self.currentSourceMeta[index].files =
          self.currentSourceMeta[index].files
            .filter((file) => file !== source);

        // 2. Remove the file reference from the indexes
        self.currentSourceRelIndex.get(source)?.delete(index);
        delete self.currentSourceFsIndex[p];

        // 3. Trigger a silent change, so that if there is an override/parent file
        // it will be copied to the build source.
        self.onSourceChange(filePath, true);

        // TODO: we can do in-process recalculations to regenerate the import files
        // when required in the future. It would require a more complex detection
        // per "current entrypoints" similar to what we are doing in the build process
        // when we generate the import files.
      },
      async buildBefore(options = {}) {
        await self.cleanUpBuildRoot();
        self.currentSourceMeta = await self.computeSourceMeta({
          copyFiles: true
        });
        const entrypoints = self.apos.asset.getBuildEntrypoints();
        await self.createImports(entrypoints);

        // Copy the public files so that Vite is not complaining about missing files
        // while building the project.
        try {
          await fs.copy(
            path.join(self.apos.asset.getBundleRootDir(), 'modules'),
            path.join(self.buildRoot, 'modules')
          );
        } catch (_) {
          // do nothing
        }
      },
      getDevServerUrl() {
        if (!self.buildOptions.devServer) {
          return null;
        }
        return self.apos.asset.getBaseDevSiteUrl() + '/__vite';
      },
      // Private methods
      async initWhenReady() {
        self.buildRoot = self.apos.asset.getBuildRootDir();
        self.buildRootSource = path.join(self.buildRoot, self.buildSourceFolderName);
        self.distRoot = path.join(self.buildRoot, self.distFolderName);
        self.buildManifestPath = path.join(self.distRoot, '.vite/manifest.json');

        await fs.mkdir(self.buildRootSource, { recursive: true });
      },
      // Create a vite instance. This can be called only when we have
      // a running express server. See handlers `afterListen`.
      async createViteInstance({ hmr }) {
        const vite = await import('vite');
        const viteConfig = await self.getViteConfig({ devServer: true });
        // FIXME use Vite's merge here.
        // Provide the parent server. Read the note in the URL below.
        // https://vite.dev/guide/api-javascript.html#createserver
        const config = {
          ...viteConfig,
          base: '/__vite',
          server: {
            ...viteConfig.server,
            middlewareMode: {
              server: self.apos.app
            }
          }
        };

        if (hmr) {
          // Attach the HMR server to the apos express server
          // https://github.com/vitejs/vite/issues/15297#issuecomment-1849135695
          config.server = {
            ...config.server,
            hmr: {
              server: self.apos.modules['@apostrophecms/express'].server
            }
          };
        } else {
          // Disable HMR
          config.server = {
            ...config.server,
            hmr: false,
            watch: null
          };
        }

        const instance = await vite.createServer({
          ...config,
          configFile: false
        });
        self.viteDevMiddleware = instance.middlewares;
      },
      // Compute metadata for the source files of all modules using
      // the core asset handler. Optionally copy the files to the build
      // source and write the metadata to a JSON file.
      async computeSourceMeta({ copyFiles = false } = {}) {
        const options = {
          modules: self.apos.asset.getRegisteredModules(),
          stats: true
        };
        if (copyFiles) {
          options.asyncHandler = async (entry) => {
            for (const file of entry.files) {
              await fs.copy(
                path.join(entry.dirname, file),
                path.join(self.buildRootSource, entry.name, file)
              );
            }
          };
        }
        // Do not bother with modules that are only "virtual" and do not have
        // any files to process.
        return (await self.apos.asset.computeSourceMeta(options))
          .filter((entry) => entry.exists);
      },
      // Generate the import files for all entrypoints and the pre-build manifest.
      async createImports(entrypoints) {
        for (const entrypoint of entrypoints) {
          if (entrypoint.condition === 'nomodule') {
            self.apos.util.warnDev(
              `The entrypoint "${entrypoint.name}" is marked as "nomodule". ` +
              'This is not supported by Vite and will be skipped.'
            );
            continue;
          }
          if (entrypoint.type === 'bundled') {
            await self.copyExternalBundledAsset(entrypoint);
            continue;
          }
          const output = await self.getEntrypointOutput(entrypoint);
          await self.apos.asset.writeEntrypointFile(output);

          self.entrypointsManifest.push({
            ...entrypoint,
            manifest: self.toManifest(entrypoint)
          });
        }
      },
      // Copy and concatenate the externally bundled assets.
      async copyExternalBundledAsset(entrypoint) {
        if (entrypoint.type !== 'bundled') {
          return;
        }
        const filesByOutput = self.apos.asset.getEntrypointManger(entrypoint)
          .getSourceFiles(self.currentSourceMeta);
        const manifestFiles = {};
        for (const [ output, files ] of Object.entries(filesByOutput)) {
          if (!files.length) {
            continue;
          }
          const raw = files
            .map(({ path: filePath }) => fs.readFileSync(filePath, 'utf8'))
            .join('\n');

          await self.apos.asset.writeEntrypointFile({
            importFile: path.join(self.buildRoot, `${entrypoint.name}.${output}`),
            prologue: entrypoint.prologue,
            raw
          });
          manifestFiles[output] = manifestFiles[output] || [];
          manifestFiles[output].push(`${entrypoint.name}.${output}`);
        }
        self.entrypointsManifest.push({
          ...entrypoint,
          manifest: self.toManifest(entrypoint, manifestFiles)
        });
      },
      async getEntrypointOutput(entrypoint) {
        const manager = self.apos.asset.getEntrypointManger(entrypoint);
        const files = manager.getSourceFiles(
          self.currentSourceMeta,
          { composePath: self.composeSourceImportPath }
        );
        const output = await manager.getOutput(files, { modules: self.apos.asset.getRegisteredModules() });
        output.importFile = path.join(self.buildRootSource, `${entrypoint.name}.js`);

        return output;
      },
      // Adds `manifest` property (object) to the entrypoint.
      // See apos.asset.configureBuildModule() for more information.
      // Called only when a rollup build is triggered.
      async applyManifest(entrypoints, viteManifest) {
        const result = [];
        for (const entrypoint of entrypoints) {
          const manifest = Object.values(viteManifest)
            .find((entry) => entry.isEntry && entry.name === entrypoint.name);

          // The entrypoint type `bundled` is not processed by Vite.
          if (!manifest) {
            result.push(entrypoint);
            continue;
          }

          const convertFn = (ref) => viteManifest[ref].file;
          const css = [
            ...manifest.css || [],
            ...getFiles({
              manifest: viteManifest,
              entry: manifest,
              sources: [ 'imports', 'dynamicImports' ],
              target: 'css'
            })
          ];
          const assets = [
            ...manifest.assets || [],
            ...getFiles({
              manifest: viteManifest,
              entry: manifest,
              sources: [ 'imports', 'dynamicImports' ],
              target: 'assets'
            })
          ];
          const imports = [
            ...manifest.imports?.map(convertFn) ?? [],
            ...getFiles({
              manifest: viteManifest,
              entry: manifest,
              convertFn,
              sources: [ 'imports' ],
              target: 'imports'
            })
          ];
          const dynamicImports = [
            ...manifest.dynamicImports?.map(convertFn) ?? [],
            ...getFiles({
              manifest: viteManifest,
              entry: manifest,
              convertFn,
              sources: [ 'dynamicImports' ],
              target: 'dynamicImports'
            })
          ];
          entrypoint.manifest = {
            root: self.distFolderName,
            files: {
              js: [ manifest.file ],
              css,
              assets,
              imports,
              dynamicImports
            },
            src: {
              js: [ manifest.src ]
            },
            devServerUrl: self.getDevServerUrl()
          };
          result.push(entrypoint);
        }

        function defaultConvertFn(ref) {
          return ref;
        }
        function getFiles({
          manifest, entry, data, sources, target, convertFn = defaultConvertFn
        }, acc = [], seen = {}) {
          if (Array.isArray(data)) {
            acc.push(...data.map(convertFn));
          }
          for (const source of sources) {
            if (!Array.isArray(entry?.[source])) {
              continue;
            }
            entry[source].forEach(ref => {
              if (seen[`${source}-${ref}`]) {
                return;
              }
              seen[`${source}-${ref}`] = true;
              manifest[ref] && getFiles({
                manifest,
                entry: manifest[ref],
                data: manifest[ref][target],
                sources,
                target,
                convertFn
              }, acc, seen);
            });
          }
          return acc;
        }

        return result;
      },
      // Accepts an entrypoint and optional files object and returns a manifest-like object.
      // This handler is used in the initializing phase of the build process.
      // In real build situations (production), it will be overridden by the `applyManifest` method.
      // The only exceptions is the `bundled` entrypoint type, which is not processed by Vite and will
      // always contain the static files provided by the `files` object.
      // Called always when a build is triggered.
      toManifest(entrypoint, files) {
        if (entrypoint.type === 'bundled') {
          const result = {
            root: '',
            files: {
              js: files?.js || [],
              css: files?.css || [],
              assets: [],
              imports: [],
              dynamicImports: []
            },
            // Bundled entrypoints are not served by the dev server.
            src: null,
            devServerUrl: null
          };
          if (result.files.js.length || result.files.css.length) {
            return result;
          }
          return null;
        }
        return {
          root: self.distFolderName,
          files: {
            js: [],
            css: [],
            assets: [],
            imports: [],
            dynamicImports: []
          },
          // This can be extended, for now we only support JS entries.
          // It's used to inject the entrypoint into the HTML.
          src: {
            js: [ path.join(self.buildSourceFolderName, `${entrypoint.name}.js`) ]
          },
          devServerUrl: self.getDevServerUrl()
        };
      },
      // FIXME: this will work only after building. There will be an additional
      // core system that will copy an preserve the final manifest. Rework it.
      async getViteBuildManifest() {
        try {
          return await fs.readJson(self.buildManifestPath);
        } catch (e) {
          return {};
        }
      },
      async getViteBuild(options) {
        // FIXME make it an import when we become an ES module.
        const { build } = await import('vite');
        const config = await self.getViteConfig(options);
        return {
          build,
          config
        };
      },
      // FIXME: This should become a vite plugin.
      async getViteConfig(options = {}) {
        // FIXME make it an import when we become an ES module.
        const vue = await import('@vitejs/plugin-vue');
        const entrypoints = self.entrypointsManifest
          .filter((entrypoint) => entrypoint.type !== 'bundled')
          .map((entrypoint) => ([
            entrypoint.name,
            path.join(self.buildRootSource, `${entrypoint.name}.js`)
          ]));
        const input = Object.fromEntries(entrypoints);
        // const cssRegex = /\.([s]?[ac]ss)$/;

        /** @type {import('vite').UserConfig} */
        const config = {
          // FIXME: passed down from the build module
          mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
          // We might need to utilize the advanced asset settings here.
          // https://vite.dev/guide/build.html#advanced-base-options
          // For now we just use the (real) asset base URL.
          base: self.apos.asset.getAssetBaseSystemUrl(),
          root: self.buildRoot,
          appType: 'custom',
          publicDir: false,
          // TODO research if separation per namespace (multisite) is needed
          cacheDir: path.join(self.apos.rootDir, 'data/temp', self.apos.asset.getNamespace(), 'vite'),
          clearScreen: false,
          // FIXME: should be provided by the entrypoint configuration, we miss that info.
          css: {
            preprocessorOptions: {
              scss: {
                api: 'modern-compiler',
                additionalData: `
                @use 'sass:math';
                @import "${self.buildRootSource}/@apostrophecms/ui/apos/scss/mixins/import-all.scss";
                `
                // FIXME: still no luck with fixing our /modules/ URLs.
                // importers: [ {
                //   // An importer that redirects relative URLs starting with "~" to
                //   // `node_modules`.
                //   findFileUrl(url) {
                //     if (url.startsWith('/modules/')) {
                //       console.log('FOUND MODULE URL', url);
                //     }
                //     return null;
                //   }
                // } ]
              }
            }
          },
          plugins: [
            myPlugin(), vue.default()
          ],
          build: {
            chunkSizeWarningLimit: 2000,
            outDir: 'dist',
            cssCodeSplit: true,
            manifest: true,
            sourcemap: !options.devServer,
            emptyOutDir: true,
            assetDir: 'assets',
            rollupOptions: {
              input,
              output: {
                entryFileNames: '[name]-build.js'
                // Keep the original build hashed CSS file names.
                // They will be processed by the post build system where
                // we provide a build manifest.
                // assetFileNames: '[name]-build[extname]',
              }
            }
          }
        };

        return config;

        function myPlugin() {
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
              // const transformedPath = path.join(self.buildRootSource, moduleName, 'apos', ...chunks);
              const resolved = await this.resolve(
                path.join(self.buildRootSource, moduleName, 'apos', ...chunks),
                importer,
                options
              );
              if (!resolved) {
                // FIXME - log system
                console.error('APOS MODULE RESOLVE FAILED!',
                  'FROM: ' + source,
                  'TO' + path.join(self.buildRootSource, moduleName, 'apos', ...chunks)
                );
              }
              return resolved;
            }
            // Transform `/modules/` URLs in CSS files to the correct asset URL.
            // Here for reference for now, the `base` property in the Vite config
            // seems to fix all related issues. We only have to offer the `/modules/`
            // folder in the build root. Vite is rewriting the URLs correctly and pointing
            // them to `baseAssetUrl()/modules/` which is the correct behavior.
            // async transform(src, id) {
            //   if (cssRegex.test(id.split('?')[0]) && src.includes('/modules/')) {
            //     return {
            //       code: self.apos.asset.filterCss(src, {
            //         // FIXME: this should be another asset URL - here we need
            //         // the ACTUAL apos URL and not the dev server one.
            //         // We need to have a getAssetBaseUrlPath method and use
            //         // the apos baseUrl to build the url here.
            //         modulesPrefix: `${self.apos.asset.getAssetBaseUrl()}/modules`
            //       }),
            //       map: null
            //     };
            //   }
            // }
          };
        }
      },
      async cleanUpBuildRoot() {
        await fs.remove(self.buildRoot);
        await fs.mkdir(self.buildRoot, { recursive: true });
      }
    };
  }
};
