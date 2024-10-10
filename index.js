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
        console.log('TODO: Build with Vite, options, etc');
        await self.cleanUpBuildRoot();
        self.currentSourceMeta = await self.computeSourceMeta({ copy: true });
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

        if (copy) {
          await fs.writeFile(
            path.join(self.buildRootSource, 'meta.json'),
            JSON.stringify(meta, null, 2)
          );
        }

        return meta;
      },
      async cleanUpBuildRoot() {
        await fs.remove(self.buildRoot);
        await fs.mkdirp(self.buildRoot);
      }
    };
  }
};
