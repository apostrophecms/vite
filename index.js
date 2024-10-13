const path = require('node:path');
const fs = require('fs-extra');
module.exports = {
  before: '@apostrophecms/asset',
  i18n: {
    aposVite: {}
  },
  init(self) {
    self.buildRoot = null;
    self.buildRootSource = null;
    self.buildModules = [];

    // Cached metadata for the current run
    self.currentSourceMeta = null;
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
      async build(options) {
        await self.cleanUpBuildRoot();
        self.currentSourceMeta = await self.computeSourceMeta({ copyFiles: true });
        const entrypoints = self.apos.asset.getBuildEntrypoints();
        await self.createImports(entrypoints);
        await self.copyExternalBundledAssets(entrypoints);

        const { build, config } = await self.getViteBuild(options);
        // console.log('VITE CONFIG', require('util').inspect(config, {
        //   depth: null,
        //   colors: true
        // }));
        try {
          await build(config);
          // const result = await build(config);
          // console.log('VITE BUILD RESULT', require('util').inspect(result, {
          //   depth: null,
          //   colors: true
          // }));
        } catch (e) {
          console.error('VITE BUILD ERROR', e.message);
        }
      },

      // Private methods
      async initWhenReady() {
        self.buildRoot = self.apos.asset.getBuildRootDir();
        self.buildRootSource = path.join(self.buildRoot, 'src');
        self.buildModules = self.apos.modulesToBeInstantiated();
        self.entrypointsManifest = [];

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
            manifest: [
              {
                path: output.importFile,
                type: 'js'
              }
            ]
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
          // FIXME - standard manifest format derived from vite build manifest format.
          const manifest = [];

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

            manifest.push({
              path: importFile,
              type: output
            });
          }
          self.entrypointsManifest.push({
            ...entrypoint,
            manifest
          });
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
      async getViteConfig(options) {
        // FIXME make it an import when we become an ES module.
        const vue = await import('@vitejs/plugin-vue');
        const entrypoints = self.entrypointsManifest
          .filter((entrypoint) => entrypoint.bundle)
          .map((entrypoint) => ([
            entrypoint.name,
            path.join(self.buildRootSource, `${entrypoint.name}.js`)
          ]));
        const input = Object.fromEntries(entrypoints);

        return {
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
            emptyOutDir: true,
            assetDir: 'assets',
            rollupOptions: {
              // FIXME: compile from the entrypoint configuration
              input,
              // input: {
              // // 'apos-build': './apos-build/vite/src/apos.js',
              //   src: path.join(self.buildRootSource, 'src.js')
              // },
              output: {
                entryFileNames: '[name]-build.js'
                // assetFileNames: '[name]-build[extname]'
              }
            }
          }
        };

        function myPlugin() {
          return {
            name: 'my-plugin',
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
                console.log('[resolveId] RESOLVE FAILED',
                  source,
                  path.join(self.buildRootSource, moduleName, 'apos', ...chunks)
                );
              }
              return resolved;
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
