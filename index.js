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
    self.buildOptions = {};
    self.viteDevInstance = null;
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
      },
      'apostrophe:destroy': {
        async destroyBuildWatcher() {
          if (self.viteDevInstance) {
            await self.viteDevInstance.close();
            self.viteDevInstance = null;
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
          if (!self.shouldCreateDevServer || !self.viteDevInstance) {
            return res.status(403).send('forbidden');
          }
          // Do not provide `next` to the middleware, we want to stop the chain here
          // if the request is handled by Vite. It provides its own 404 handler.
          self.viteDevInstance.middlewares(req, res);
        }
      }
    };
  },

  methods(self) {
    return {
      // see @apostrophecms/assset:getBuildOptions() for the options shape.
      // A required interface for the asset module.
      async build(options = {}) {
        self.buildOptions = options;
        await self.buildBefore(options);

        await self.buildPublic(options);
        const ts = await self.buildApos(options);

        const viteManifest = await self.getViteBuildManifest();
        self.entrypointsManifest = await self.applyManifest(self.entrypointsManifest, viteManifest);
        return {
          entrypoints: self.entrypointsManifest,
          sourceMapsRoot: self.distRoot,
          devServerUrl: null,
          ts
        };
      },
      // A required interface for the asset module.
      async startDevServer(options) {
        self.buildOptions = options;
        self.shouldCreateDevServer = true;
        await self.buildBefore(options);

        const { scenes: currentScenes, build: currentBuild } = self.getCurrentMode(options.devServer);

        self.entrypointsManifest.unshift(self.getViteEntrypoint(currentScenes));

        let ts;
        if (currentBuild === 'public') {
          await self.buildPublic(options);
        }
        if (currentBuild === 'apos') {
          ts = await self.buildApos(options);
        }

        const viteManifest = await self.getViteBuildManifest(currentBuild);
        self.entrypointsManifest = await self.applyManifest(self.entrypointsManifest, viteManifest);

        return {
          entrypoints: self.entrypointsManifest,
          hmrTypes: [ ...new Set(
            self.getBuildEntrypointsFor(options.devServer)
              .map((entry) => entry.type)
          ) ],
          ts,
          devServerUrl: self.getDevServerUrl()
        };
      },
      // A required interface for the asset module.
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
      // A required interface for the asset module.
      // This method is called when build and watch are not triggered.
      // Enhance and return any entrypoints that are included in the manifest
      // when an actual build/devServer is triggered.
      // The options are same as the ones provided in the `build` adn `startDevServer` methods.
      async entrypoints(options) {
        const entrypoints = self.apos.asset.getBuildEntrypoints(options.types)
          .filter(entrypoint => entrypoint.condition !== 'nomodule');

        if (options.devServer) {
          const { scenes } = self.getCurrentMode(options.devServer);
          entrypoints.unshift(self.getViteEntrypoint(scenes));
        }

        return entrypoints;
      },
      async buildBefore(options = {}) {
        if (options.isTask) {
          await self.cleanUpBuildRoot();
        }
        self.currentSourceMeta = await self.computeSourceMeta({
          copyFiles: true
        });
        const entrypoints = self.apos.asset.getBuildEntrypoints(options.types);
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
      // Builds the apos UI assets.
      async buildApos(options) {
        const execute = await self.shouldBuild('apos', options);

        if (!execute) {
          return;
        }

        self.printLabels('apos', true);
        const { build, config } = await self.getViteBuild('apos', options);
        await build(config);
        self.printLabels('apos', false);

        return Date.now();
      },
      // Builds the public assets.
      async buildPublic(options) {
        if (self.getBuildEntrypointsFor('public').length === 0) {
          return false;
        }
        // It's OK because it will execute once if no manifest and dev server is on.
        if (options.devServer === 'public') {
          const execute = await self.shouldBuild('public', options);
          if (!execute) {
            return;
          }
        }
        self.printLabels('public', true);
        const { build, config } = await self.getViteBuild('public', options);
        await build(config);
        self.printLabels('public', false);
      },
      getViteEntrypoint(scenes) {
        return {
          name: 'vite',
          type: 'bundled',
          scenes,
          outputs: [ 'js' ],
          manifest: {
            root: '',
            files: {},
            src: {
              js: [ '@vite/client' ]
            },
            devServer: true
          }
        };
      },
      getCurrentMode(devServer) {
        let currentBuild;
        const currentScenes = [];
        if (devServer === 'apos') {
          currentBuild = 'public';
          currentScenes.push('apos');
        }
        if (devServer === 'public') {
          currentBuild = 'apos';
          currentScenes.push('public', 'apos');
        }

        return {
          build: currentBuild,
          scenes: currentScenes
        };
      },
      // Assesses if the apos build should be triggered.
      async shouldBuild(id, options) {
        if (self.getBuildEntrypointsFor(id).length === 0) {
          return false;
        }
        if (options.isTask || process.env.APOS_DEV === '1') {
          return true;
        }
        // Forced build by type. Keeping the core current logic.
        if (options.types?.includes(id)) {
          return true;
        }
        if (!self.hasViteBuildManifest(id)) {
          return true;
        }

        const aposManifest = await self.apos.asset.loadSavedBuildManifest();
        const lastBuildMs = aposManifest.ts || 0;
        const lastSystemChange = await self.apos.asset.getSystemLastChangeMs();
        if (lastSystemChange !== false && lastBuildMs > lastSystemChange) {
          return false;
        }

        return true;
      },
      printLabels(id, before) {
        const phrase = before ? 'apostrophe:assetTypeBuilding' : 'apostrophe:assetTypeBuildComplete';
        const req = self.apos.task.getReq();
        const labels = [ ...new Set(
          self.getBuildEntrypointsFor(id).map(e => req.t(e.label))
        ) ];

        if (labels.length) {
          self.apos.util.log(
            req.t(phrase, { label: labels.join(', ') })
          );
        }
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
      getRootPath(onChangePath) {
        return path.join(self.apos.npmRootDir, onChangePath);
      },
      onSourceAdd(filePath, isDir) {
        if (isDir) {
          return;
        }
        const p = self.getRootPath(filePath);
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
        const p = self.getRootPath(filePath);
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
        const p = self.getRootPath(filePath);
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
      // Get the base URL for the dev server.
      // If an entrypoint `type` is is provided, a check against the current build options
      // will be performed and appropriate values will be returned.
      getDevServerUrl() {
        return self.apos.asset.getBaseMiddlewareUrl() + '/__vite';
      },
      hasDevServerUrl(type) {
        if (!self.buildOptions.devServer) {
          return false;
        }
        if (type === 'bundled') {
          return false;
        }
        if (type === 'apos' && self.buildOptions.devServer === 'public') {
          return false;
        }
        if (type && type !== 'apos' && self.buildOptions.devServer === 'apos') {
          return false;
        }

        return true;
      },
      // Private methods
      async initWhenReady() {
        self.buildRoot = self.apos.asset.getBuildRootDir();
        self.buildRootSource = path.join(self.buildRoot, self.buildSourceFolderName);
        self.distRoot = path.join(self.buildRoot, self.distFolderName);

        const publicRel = '.public/manifest.json';
        const aposRel = '.apos/manifest.json';
        self.buildManifestPath = {
          publicRel,
          aposRel,
          public: path.join(self.distRoot, publicRel),
          apos: path.join(self.distRoot, aposRel)
        };

        self.userConfigFile = path.join(self.apos.rootDir, 'apos.vite.config.mjs');
        if (!fs.existsSync(self.userConfigFile)) {
          self.userConfigFile = path.join(self.apos.rootDir, 'apos.vite.config.js');
        }
        if (!fs.existsSync(self.userConfigFile)) {
          self.userConfigFile = null;
        }

        await fs.mkdir(self.buildRootSource, { recursive: true });
      },
      // Create a vite instance. This can be called only when we have
      // a running express server. See handlers `afterListen`.
      async createViteInstance(options) {
        const vite = await import('vite');
        const viteConfig = await self.getViteConfig(options.devServer, options);
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

        // FIXME use Vite's merge here.
        if (options.hmr) {
          // Attach the HMR server to the apos express server
          // https://github.com/vitejs/vite/issues/15297#issuecomment-1849135695
          config.server = {
            ...config.server,
            hmr: {
              server: self.apos.modules['@apostrophecms/express'].server,
              port: options.hmrPort || undefined
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
        self.viteDevInstance = instance;
        self.apos.util.log(
          `HMR for "${options.devServer}" started`
        );
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
            devServer: self.hasDevServerUrl(entrypoint.type)
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
            devServer: false
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
          devServer: self.hasDevServerUrl(entrypoint.type)
        };
      },
      // Get the build manifest for the current run.
      // If `id` is provided, it will return the manifest for the given ID.
      // Possible values are `public` and `apos`.
      async getViteBuildManifest(id) {
        let apos = {};
        let pub = {};
        if (!id || id === 'apos') {
          try {
            apos = await fs.readJson(self.buildManifestPath.apos);
          } catch (e) {
            apos = {};
          }
        }
        if (!id || id === 'public') {
          try {
            pub = await fs.readJson(self.buildManifestPath.public);
          } catch (e) {
            pub = {};
          }
        }

        return {
          ...apos,
          ...pub
        };
      },
      // `id` is `public` or `apos`
      hasViteBuildManifest(id) {
        return fs.existsSync(self.buildManifestPath[id]);
      },
      // `id` is `public` or `apos`
      getBuildEntrypointsFor(id) {
        if (id === 'apos') {
          return self.entrypointsManifest
            .filter((entrypoint) => entrypoint.type === 'apos');
        }
        if (id === 'public') {
          return self.entrypointsManifest
            .filter((entrypoint) => ![ 'bundled', 'apos' ].includes(entrypoint.type));
        }
        throw new Error(`Invalid build ID "${id}"`);
      },
      // `id` is `public` or `apos`
      async getViteBuild(id, options) {
        const { build } = await import('vite');
        const config = await self.getViteConfig(id, options);
        return {
          build,
          config
        };
      },
      // `id` is `public` or `apos`
      async getViteConfig(id, options = {}) {
        if (id === 'public') {
          return await self.getPublicViteConfig(options);
        }
        if (id === 'apos') {
          return await self.getAposViteConfig(options);
        }
        throw new Error(`Invalid Vite config ID "${id}"`);
      },
      // FIXME: This should become a vite plugin. Rework and cleanup the config.
      async getAposViteConfig(options = {}) {
        // FIXME make it an import when we become an ES module.
        const vue = await import('@vitejs/plugin-vue');
        const entrypoints = self.getBuildEntrypointsFor('apos')
          .map((entrypoint) => ([
            entrypoint.name,
            path.join(self.buildRootSource, `${entrypoint.name}.js`)
          ]));
        const input = Object.fromEntries(entrypoints);
        // const cssRegex = /\.([s]?[ac]ss)$/;

        /** @type {import('vite').UserConfig} */
        const config = {
          mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
          // We might need to utilize the advanced asset settings here.
          // https://vite.dev/guide/build.html#advanced-base-options
          // For now we just use the (real) asset base URL.
          base: self.apos.asset.getAssetBaseUrl(),
          root: self.buildRoot,
          appType: 'custom',
          publicDir: false,
          cacheDir: path.join(self.apos.rootDir, 'data/temp', self.apos.asset.getNamespace(), 'vite/apos'),
          clearScreen: false,
          // Breaks symlinked modules if not enabled
          resolve: {
            preserveSymlinks: true
          },
          css: {
            preprocessorOptions: {
              scss: {
                api: 'modern-compiler',
                silenceDeprecations: [ 'import' ],
                additionalData: `
                @use 'sass:math';
                @import "${self.buildRootSource}/@apostrophecms/ui/apos/scss/mixins/import-all.scss";
                `
              }
            }
          },
          plugins: [
            VitePluginApos(), vue.default()
          ],
          build: {
            chunkSizeWarningLimit: 2000,
            outDir: 'dist',
            cssCodeSplit: true,
            manifest: self.buildManifestPath.aposRel,
            sourcemap: !options.sourcemaps,
            emptyOutDir: false,
            assetDir: 'assets',
            rollupOptions: {
              input,
              output: {
                entryFileNames: '[name]-build.js'
              }
            }
          }
        };

        return config;

        function VitePluginApos() {
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
                  'TO: ' + path.join(self.buildRootSource, moduleName, 'apos', ...chunks)
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
      async getPublicViteConfig(options = {}) {
        const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';

        const entrypoints = self.getBuildEntrypointsFor('public')
          .map((entrypoint) => ([
            entrypoint.name,
            path.join(self.buildRootSource, `${entrypoint.name}.js`)
          ]));
        const input = Object.fromEntries(entrypoints);

        /** @type {import('vite').UserConfig} */
        const config = {
          mode,
          // We might need to utilize the advanced asset settings here.
          // https://vite.dev/guide/build.html#advanced-base-options
          // For now we just use the (real) asset base URL.
          base: self.apos.asset.getAssetBaseUrl(),
          root: self.buildRoot,
          appType: 'custom',
          publicDir: false,
          cacheDir: path.join(self.apos.rootDir, 'data/temp', self.apos.asset.getNamespace(), 'vite/public'),
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
            chunkSizeWarningLimit: 2000,
            outDir: 'dist',
            cssCodeSplit: true,
            manifest: self.buildManifestPath.publicRel,
            sourcemap: options.sourcemaps,
            emptyOutDir: false,
            assetDir: 'assets',
            rollupOptions: {
              input,
              output: {
                entryFileNames: '[name]-build.js'
              }
            }
          }
        };

        const vite = await import('vite');
        const configEnv = {
          command: options.command ?? 'build',
          mode,
          isPreview: false,
          isSsrBuild: false
        };
        let userConfig = {};

        const loaded = await vite.loadConfigFromFile(
          configEnv,
          self.userConfigFile,
          self.apos.rootDir,
          'silent'
        );
        if (loaded) {
          userConfig = loaded.config;
        }

        // Merge it
        const mergeConfigs = vite.defineConfig((configEnv) => {
          let merged = config;
          for (const { extensions, name } of self.getBuildEntrypointsFor('public')) {
            if (!extensions) {
              continue;
            }
            for (const [ key, value ] of Object.entries(extensions)) {
              self.apos.asset.printDebug('public-config-merge', `[${name}] merging "${key}"`, {
                entrypoint: name,
                [key]: value
              });
              merged = vite.mergeConfig(merged, value);
            }
          }
          merged = vite.mergeConfig(merged, userConfig);

          return merged;
        });

        return mergeConfigs(configEnv);
      },
      async cleanUpBuildRoot() {
        await fs.remove(self.buildRoot);
        await fs.mkdir(self.buildRoot, { recursive: true });
      }
    };
  }
};
