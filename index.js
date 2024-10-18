const path = require('node:path');
const fs = require('fs-extra');
module.exports = {
  before: '@apostrophecms/asset',
  i18n: {
    aposVite: {}
  },
  init(self) {
    self.buildSourceFolderName = 'src';
    self.distFolderName = 'dist';
    self.buildRoot = null;
    self.buildRootSource = null;
    self.distRoot = null;
    self.buildModules = [];
    self.buildManifestPath = null;

    // Cached metadata for the current run
    self.currentSourceMeta = null;
    self.entrypointsManifest = [];

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
            hasDevServer: true,
            hasHMR: true
          });
          await self.initWhenReady();
        }
      }
    };
  },

  methods(self) {
    return {
      async build(options = {}) {
        await self.cleanUpBuildRoot();
        self.currentSourceMeta = await self.computeSourceMeta({ copyFiles: true });
        const entrypoints = self.apos.asset.getBuildEntrypoints();
        await self.createImports(entrypoints);

        // Copy the public files so that Vite is not complaining about missing files
        // while building the project.
        // FIXME: move to `preBuild` method, called by the asset module.
        try {
          await fs.copy(
            path.join(self.apos.asset.getBundleRootDir(), 'modules'),
            path.join(self.buildRoot, 'modules')
          );
        } catch (_) {
          // do nothing
        }

        // Always build in production mode.
        const { build, config } = await self.getViteBuild(options);

        const currentEnv = process.env.NODE_ENV;
        await build(config);
        process.env.NODE_ENV = currentEnv;

        const viteManifest = await self.getViteBuildManifest();
        self.entrypointsManifest = await self.applyManifest(self.entrypointsManifest, viteManifest);
        return {
          entrypoints: self.entrypointsManifest,
          sourceMapsRoot: self.distRoot
        };
      },
      // Private methods
      async initWhenReady() {
        self.buildRoot = self.apos.asset.getBuildRootDir();
        self.buildRootSource = path.join(self.buildRoot, self.buildSourceFolderName);
        self.buildModules = self.apos.modulesToBeInstantiated();
        self.distRoot = path.join(self.buildRoot, self.distFolderName);
        self.buildManifestPath = path.join(self.distRoot, '.vite/manifest.json');

        await fs.mkdir(self.buildRootSource, { recursive: true });
      },
      // Compute metadata for the source files of all modules using
      // the core asset handler. Optionally copy the files to the build
      // source and write the metadata to a JSON file.
      async computeSourceMeta({ copyFiles = false } = {}) {
        const options = {
          modules: self.buildModules
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
        return self.apos.asset.computeSourceMeta(options);
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
          const output = self.getEntrypointOutput(entrypoint);
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
      getEntrypointOutput(entrypoint) {
        const manager = self.apos.asset.getEntrypointManger(entrypoint);
        const files = manager.getSourceFiles(
          self.currentSourceMeta,
          { composePath: self.composeSourceImportPath }
        );
        const output = manager.getOutput(files, { modules: self.buildModules });
        output.importFile = path.join(self.buildRootSource, `${entrypoint.name}.js`);

        return output;
      },
      // Adds `manifest` property (object) to the entrypoint.
      // See apos.asset.configureBuildModule() for more information.
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
          const jsConvertFn = (ref) => viteManifest[ref].file;
          const imports = [
            ...manifest.imports?.map(jsConvertFn) ?? [],
            ...getFiles({
              manifest: viteManifest,
              entry: manifest,
              convertFn: jsConvertFn,
              sources: [ 'imports' ],
              target: 'imports'
            })
          ];
          const dynamicImports = [
            ...manifest.dynamicImports?.map(jsConvertFn) ?? [],
            ...getFiles({
              manifest: viteManifest,
              entry: manifest,
              convertFn: jsConvertFn,
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
            // patch references to point to the real file, and not to a key from the manifest.
            // Those should be copied to the bundle folder and released. They should be
            // inserted into the HTML with `rel="modulepreload"` attribute.
            // imports: manifest.imports?.map((file) => viteManifest[file]?.file).filter(Boolean) ?? [],
            // imports: manifest.imports?.map((file) => viteManifest[file]?.file).filter(Boolean) ?? [],
            src: [ manifest.src ],
            // FIXME: this should be the actual dev server URL, retrieved by a vite instance
            devServerUrl: null
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
          // Bundled entrypoints are not served by the dev server.
          src: [ path.join(self.buildSourceFolderName, `${entrypoint.name}.js`) ],
          // FIXME: this should be the actual dev server URL, retrieved by a vite instance
          devServerUrl: null
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
      async getViteConfig({ mode }) {
        // FIXME make it an import when we become an ES module.
        const vue = await import('@vitejs/plugin-vue');
        const entrypoints = self.entrypointsManifest
          .filter((entrypoint) => entrypoint.type !== 'bundled')
          .map((entrypoint) => ([
            entrypoint.name,
            path.join(self.buildRootSource, `${entrypoint.name}.js`)
          ]));
        const input = Object.fromEntries(entrypoints);
        const cssRegex = /\.([s]?[ac]ss)$/;

        /** @type {import('vite').UserConfig} */
        const config = {
          // FIXME: passed down from the build module
          mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
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
            sourcemap: true,
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
            },
            // Transform `/modules/` URLs in CSS files to the correct asset URL.
            async transform(src, id) {
              if (cssRegex.test(id.split('?')[0]) && src.includes('/modules/')) {
                return {
                  code: self.apos.asset.filterCss(src, {
                    // FIXME: this should be another asset URL - here we need
                    // the ACTUAL apos URL and not the dev server one.
                    // We need to have a getAssetBaseUrlPath method and use
                    // the apos baseUrl to build the url here.
                    modulesPrefix: `${self.apos.asset.getAssetBaseUrl()}/modules`
                  }),
                  map: null
                };
              }
            }
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
