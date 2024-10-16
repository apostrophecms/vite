const path = require('node:path');
const fs = require('fs-extra');
module.exports = {
  before: '@apostrophecms/asset',
  i18n: {
    aposVite: {}
  },
  init(self) {
    self.buildSourceFolderName = 'src';
    self.distSourceFolderName = 'src';
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
    // if (!process.env.NODE_ENV) {
    //   process.env.NODE_ENV = 'development';
    // }
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
        await self.copyExternalBundledAssets(entrypoints);
        // Copy the public files so that Vite is not complaining about missing files
        // while building the project.
        await fs.copy(
          path.join(self.apos.asset.getBundleRootDir(), 'modules'),
          path.join(self.buildRoot, 'modules')
        );

        // Always build in production mode.
        const { build, config } = await self.getViteBuild({
          ...options,
          mode: 'production'
        });
        try {
          const currentEnv = process.env.NODE_ENV;
          // process.env.NODE_ENV = 'production';
          await build(config);
          process.env.NODE_ENV = currentEnv;
        } catch (e) {
          self.apos.util.error(e.message);
        }

        self.entrypointsManifest = await self.applyViteManifest(self.entrypointsManifest);

        return self.getBuildManifest();
      },
      getBuildManifest() {
        return {
          distRoot: self.distRoot,
          entrypoints: self.entrypointsManifest
        };
      },
      // Private methods
      async initWhenReady() {
        self.buildRoot = self.apos.asset.getBuildRootDir();
        self.buildRootSource = path.join(self.buildRoot, self.buildSourceFolderName);
        self.buildModules = self.apos.modulesToBeInstantiated();
        self.distRoot = path.join(self.buildRoot, 'dist');
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
        const meta = await self.apos.asset.computeSourceMeta(options);

        // Write the metadata to a JSON file, for now.
        // This step might be removed in the future.
        if (copyFiles) {
          await fs.writeFile(
            path.join(self.buildRoot, '.apos.json'),
            JSON.stringify(meta, null, 2)
          );
        }

        return meta;
      },
      // Generate the import files for all entrypoints and the pre-build manifest.
      async createImports(entrypoints) {
        for (const entrypoint of entrypoints) {
          if (!entrypoint.bundle) {
            continue;
          }
          if (entrypoint.condition === 'nomodule') {
            self.apos.util.warnDev(
              `The entrypoint "${entrypoint.name}" is marked as "nomodule". ` +
              'This is not supported by Vite and will be skipped.'
            );
            continue;
          }
          const output = self.getEntrypointOutput(entrypoint);
          await self.apos.asset.writeEntrypointFileForUI(output);

          self.entrypointsManifest.push({
            ...entrypoint,
            manifest: self.toViteManifestFormat(entrypoint)
          });
        }
      },
      // Copy and concatenate the external bundled assets by entrypoint and
      // add the pre-build manifest.
      async copyExternalBundledAssets(entrypoints) {
        for (const entrypoint of entrypoints) {
          if (entrypoint.bundle) {
            continue;
          }
          const filesByOutput = self.getExternalBundleFiles(entrypoint, self.currentSourceMeta);

          for (const [ output, files ] of Object.entries(filesByOutput)) {
            const importFile = path.join(self.buildRoot, `${entrypoint.name}.${output}`);
            const raw = files
              .map(({ path: filePath }) => fs.readFileSync(filePath, 'utf8'))
              .join('\n');

            await self.apos.asset.writeEntrypointFileForUI({
              importFile,
              prologue: entrypoint.prologue,
              raw
            });
          }
          self.entrypointsManifest.push({
            ...entrypoint,
            manifest: self.toViteManifestFormat(entrypoint)
          });
        }
      },
      // Same as vite manifest but with `path` that contains the full path to the file.
      async applyViteManifest(entrypoints) {
        // Here we can add the chunking/splitting support in the future.
        const viteManifest = await self.getViteBuildManifest();
        const filteredManifest = Object.values(viteManifest)
          .filter((entry) => entry.isEntry);

        const result = [];
        for (const entrypoint of entrypoints) {
          const manifest = filteredManifest
            .find((entry) => entry.name === entrypoint.name);

          // The entrypoint marked as `bundle: false` is not processed by Vite.
          if (manifest) {
            entrypoint.manifest = {
              ...manifest,
              root: self.distRoot,
              // patch references to point to the real file, and not to a key from the manifest
              imports: manifest.imports?.map((file) => viteManifest[file]?.file).filter(Boolean) ?? []
            };
          }
          result.push(entrypoint);
        }

        return result;
      },
      // Accepts an entrypoint and returns a Vite manifest-like object (or null).
      // The difference is `devServer` boolean - true when
      // the `src` should be served by the dev server. When false,
      // the `file` should be server by the apostrophe server.
      // There is also a `root` property that is the absolute path to the fodler
      // containing the `file` or `src`.
      toViteManifestFormat(entrypoint) {
        if (!entrypoint.bundle) {
          const result = {
            root: self.buildRoot,
            devServer: false,
            name: entrypoint.name,
            file: entrypoint.outputs.includes('js') ? `${entrypoint.name}.js` : '',
            src: false,
            isEntry: true,
            css: entrypoint.outputs.filter((type) => type !== 'js')
              .map((type) => `${entrypoint.name}.${type}`)
          };
          if (result.file || result.css.length) {
            return result;
          }
          return null;
        }
        return {
          root: self.distRoot,
          devServer: true,
          name: entrypoint.name,
          file: false,
          src: path.join(self.buildSourceFolderName, `${entrypoint.name}.js`),
          isEntry: true,
          // In development (when devServer is running), there are no CSS files.
          // They are available only in real (rollup) build.
          css: []
        };
      },
      async getViteBuildManifest() {
        try {
          return await fs.readJson(self.buildManifestPath);
        } catch (e) {
          return {};
        }
      },
      // Generate the import file for an entrypoint.
      // The entrypoint.outputs info is ignored and the logic is hardcoded based
      // on other props (apos, index, useMeta) for now. We want to extend this in the
      // future to follow the entrypoint output configuration.
      getEntrypointOutput(entrypoint) {
        const meta = self.currentSourceMeta;
        let indexJs, indexSass, icon, components, tiptap, app;

        // Generate the index.js and index.scss files for the entrypoint.
        // `apos` should be `false`.
        if (entrypoint.index) {
          const { js, scss } = self.getIndexSourceFiles(entrypoint, meta);
          indexJs = self.apos.asset.getImportFileOutputForUI(js, {
            requireDefaultExport: true,
            invokeApps: true,
            importSuffix: 'App',
            enumerateImports: true
          });
          indexSass = self.apos.asset.getImportFileOutputForUI(scss, {
            importName: false
          });
        }

        // Generate the icon, components, tiptap, and app import code for the entrypoint.
        // `index` should be `false`.
        if (entrypoint.apos) {
          icon = self.apos.asset.getAposIconsOutput(self.buildModules);
          components = self.apos.asset.getImportFileOutputForUI(
            self.getAposComponentSourceFiles(entrypoint, meta).js,
            {
              registerComponents: true
            }
          );
          tiptap = self.apos.asset.getImportFileOutputForUI(
            self.getAposTiptapSourceFiles(entrypoint, meta).js,
            {
              registerTiptapExtensions: true
            }
          );
          app = self.apos.asset.getImportFileOutputForUI(
            self.getAposAppSourceFiles(entrypoint, meta).js,
            {
              importSuffix: 'App',
              enumerateImports: true,
              invokeApps: true
            }
          );
        }

        // Generate the import file only using the `sources` extra files.
        if (!entrypoint.useMeta) {
          const { js, scss } = self.getExtraSourceFiles(entrypoint, meta);
          indexJs = self.apos.asset.getImportFileOutputForUI(js, {
            requireDefaultExport: true,
            invokeApps: true,
            importSuffix: 'App',
            enumerateImports: true
          });
          indexSass = self.apos.asset.getImportFileOutputForUI(scss, {
            importName: false
          });
        }

        return {
          importFile: path.join(self.buildRootSource, `${entrypoint.name}.js`),
          prologue: entrypoint.prologue + '\n',
          indexJs,
          indexSass,
          icon,
          components,
          tiptap,
          app
        };
      },
      // Get source files for entrypoint `index: true`.
      getIndexSourceFiles(entrypoint, meta) {
        return self.apos.asset.findSourceFilesForUI(
          meta,
          self.composeSourceImportPath,
          {
            js: (file, entry) => file === `${entrypoint.name}/index.js`,
            scss: (file, entry) => file === `${entrypoint.name}/index.scss`
          },
          {
            extraSources: entrypoint.sources,
            ignoreSources: entrypoint.ignoreSources
          }
        );
      },
      // Get the component source files for entrypoint `apos: true`.
      getAposComponentSourceFiles(entrypoint, meta) {
        return self.apos.asset.findSourceFilesForUI(
          meta,
          self.composeSourceImportPath,
          {
            js: (file, entry) => file.startsWith(`${entrypoint.name}/components/`) && file.endsWith('.vue')
          },
          {
            componentOverrides: true
          }
        );
      },
      // Get the tiptap source files for entrypoint `apos: true`.
      getAposTiptapSourceFiles(entrypoint, meta) {
        return self.apos.asset.findSourceFilesForUI(
          meta,
          self.composeSourceImportPath,
          {
            js: (file, entry) => file.startsWith(`${entrypoint.name}/tiptap-extensions/`) &&
              file.endsWith('.js')
          }
        );
      },
      // Get the `app` source files for entrypoint `apos: true`.
      getAposAppSourceFiles(entrypoint, meta) {
        return self.apos.asset.findSourceFilesForUI(
          meta,
          self.composeSourceImportPath,
          {
            js: (file, entry) => file.startsWith(`${entrypoint.name}/apps/`) && file.endsWith('.js')
          }
        );
      },
      // Get extra source files for the entrypoint when `useMeta: false`.
      getExtraSourceFiles(entrypoint, meta) {
        const extraSources = entrypoint.sources;
        if (!extraSources.js.length && !extraSources.scss.length) {
          return {
            js: [],
            scss: []
          };
        }
        return self.apos.asset.findSourceFilesForUI(
          meta,
          self.composeSourceImportPath,
          {
            js: null,
            scss: null
          },
          {
            extraSources,
            skipPredicates: true
          }
        );
      },
      getExternalBundleFiles(entrypoint, meta) {
        const predicates = entrypoint.outputs.reduce((acc, type) => {
          acc[type] = (file, entry) => {

            return file.startsWith(`${entrypoint.name}/`) && file.endsWith(`.${type}`);
          };
          return acc;
        }, {});

        return self.apos.asset.findSourceFilesForUI(
          meta,
          self.composeSourceImportPath,
          predicates
        );
      },
      // The import path composer for the source files.
      composeSourceImportPath(file, entry) {
        return `./${entry.name}/${file}`;
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
          .filter((entrypoint) => entrypoint.bundle)
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
            minify: false,
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
