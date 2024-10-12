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
      async build() {
        await self.cleanUpBuildRoot();
        self.currentSourceMeta = await self.computeSourceMeta({ copy: true });
        await self.createImports();
      },

      // Private methods
      async initWhenReady() {
        self.buildRoot = self.apos.asset.getBuildRootDir();
        self.buildRootSource = path.join(self.buildRoot, 'src');
        self.buildModules = self.apos.modulesToBeInstantiated();

        await fs.mkdir(self.buildRootSource, { recursive: true });
      },
      // Compute metadata for the source files of all modules using
      // the core asset handler. Optionally copy the files to the build
      // source and write the metadata to a JSON file.
      async computeSourceMeta({ copy = false } = {}) {
        const options = {
          modules: self.buildModules
        };
        if (copy) {
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
        // This might be removed in the future.
        if (copy) {
          await fs.writeFile(
            path.join(self.buildRoot, '.apos.json'),
            JSON.stringify(meta, null, 2)
          );
        }

        return meta;
      },
      // Generate the import files for all entrypoints.
      async createImports() {
        const entrypoints = self.apos.asset.getBuildEntrypoints();
        for (const entrypoint of entrypoints) {
          if (!entrypoint.bundle) {
            continue;
          }
          const output = self.getEntrypointOutput(entrypoint);
          await self.apos.asset.writeEntrypointFileForUI(output);
        }
      },
      // Generate the import file for an entrypoint.
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
      // The import path composer for the source files.
      composeSourceImportPath(file, entry) {
        return `./${entry.name}/${file}`;
      },
      async cleanUpBuildRoot() {
        await fs.remove(self.buildRoot);
        await fs.mkdir(self.buildRoot, { recursive: true });
      }
    };
  }
};
