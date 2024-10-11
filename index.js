const path = require('node:path');
const fs = require('fs-extra');
const { stripIndent } = require('common-tags');
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

        if (copy) {
          await fs.writeFile(
            path.join(self.buildRootSource, 'apos-meta.json'),
            JSON.stringify(meta, null, 2)
          );
        }

        return meta;
      },
      async createImports() {
        const entrypoints = self.apos.asset.getBuildEntrypoints();
        for (const entrypoint of entrypoints) {
          if (!entrypoint.bundle) {
            continue;
          }
          const output = self.getEntrypointOutput(entrypoint);
          await self.writeEntrypointFile(output);
        }
      },
      getEntrypointOutput(entrypoint) {
        const meta = self.currentSourceMeta;
        let indexJs, indexSass, icon, components, tiptap, app;

        // Generate the index.js and index.scss files for the entrypoint.
        // `apos` should be `false`.
        if (entrypoint.index) {
          const { js, scss } = self.getIndexSourceFiles(entrypoint, meta);
          indexJs = self.getImportFileOutput(js, {
            requireDefaultExport: true,
            invokeApps: true,
            importSuffix: 'App',
            enumerateImports: true
          });
          indexSass = self.getImportFileOutput(scss, {
            importName: false
          });
        }

        // Generate the icon, components, tiptap, and app import code for the entrypoint.
        // `index` should be `false`.
        if (entrypoint.apos) {
          icon = self.apos.asset.getAposIconsOutput(self.buildModules);
          components = self.getImportFileOutput(
            self.getAposComponentSourceFiles(entrypoint, meta).js,
            {
              registerComponents: true
            }
          );
          tiptap = self.getImportFileOutput(
            self.getAposTiptapSourceFiles(entrypoint, meta).js,
            {
              registerTiptapExtensions: true
            }
          );
          app = self.getImportFileOutput(
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
          indexJs = self.getImportFileOutput(js, {
            requireDefaultExport: true,
            invokeApps: true,
            importSuffix: 'App',
            enumerateImports: true
          });
          indexSass = self.getImportFileOutput(scss, {
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

      // FIXME: move to the core.
      // Generate the import code for the given components.
      // The components array should contain objects with `component` and `path`
      // properties. The `component` property is the relative path to the file
      // from within the apos-build folder, and the `path` property is the absolute
      // path to the original file.
      //
      // The `options` object can be used to customize the output.
      // The following options are available:
      //
      // - requireDefaultExport: If true, the function will throw an error
      //   if a component does not have a default export.
      // - registerComponents: If true, the function will generate code to
      //   register the components in the window.apos.vueComponents object.
      // - registerTiptapExtensions: If true, the function will generate code
      //   to register the components in the window.apos.tiptapExtensions array.
      // - invokeApps: If true, the function will generate code to invoke the
      //   components as functions.
      // - importSuffix: A string that will be appended to the import name.
      // - importName: If false, the function will not generate an import name.
      // - enumerateImports: If true, the function will enumerate the import names.
      //
      // The function returns an object with `importCode`, `registerCode`, and
      // `invokeCode` string properties.
      getImportFileOutput(components, options = {}) {
        let registerCode = '';
        if (options.registerComponents) {
          registerCode = 'window.apos.vueComponents = window.apos.vueComponents || {};\n';
        } else if (options.registerTiptapExtensions) {
          registerCode = 'window.apos.tiptapExtensions = window.apos.tiptapExtensions || [];\n';
        }
        const output = {
          importCode: '',
          registerCode,
          invokeCode: ''
        };

        components.forEach((entry, i) => {
          const { component, path: realPath } = entry;
          if (options.requireDefaultExport) {
            try {
              if (!fs.readFileSync(realPath, 'utf8').match(/export[\s\n]+default/)) {
                throw new Error(stripIndent`
                      The file ${component} does not have a default export.
  
                      Any ui/src/index.js file that does not have a function as
                      its default export will cause the build to fail in production.
                    `);
              }
            } catch (e) {
              throw new Error(`The file ${realPath} does not exist.`);
            }
          }
          const jsFilename = JSON.stringify(component);
          const name = self.apos.asset.getComponentNameForUI(
            component,
            { enumerate: options.enumerateImports === true ? i : false }
          );
          const jsName = JSON.stringify(name);
          const importName = `${name}${options.importSuffix || ''}`;
          const importCode = options.importName === false
            ? `import ${jsFilename};\n`
            : `import ${importName} from ${jsFilename};\n`;

          output.importCode += `${importCode}`;

          if (options.registerComponents) {
            output.registerCode += `window.apos.vueComponents[${jsName}] = ${importName};\n`;
          }

          if (options.registerTiptapExtensions) {
            output.registerCode += stripIndent`
                  apos.tiptapExtensions.push(${importName});
                ` + '\n';
          }
          if (options.invokeApps) {
            output.invokeCode += `  ${name}${options.importSuffix || ''}();\n`;
          }
        });

        return output;
      },
      // FIXME: move to the core.
      // Get source files for entrypoint `index: true`. The `entrypoint.ignoreSources`
      // array is used to exclude files from the build. The `entrypoint.sources`
      // object is usedto include extra files.
      // `meta` is the metadata for all source files passed to the function.
      // The function returns an object with `js` and `scss` arrays, containing
      // properties `component` (relative path to the file from within the
      // apos-build folder) and `path` (full path to the file).
      getIndexSourceFiles(entrypoint, meta) {
        const result = {
          js: [],
          scss: []
        };
        if (!entrypoint.index) {
          return result;
        }

        for (const entry of meta) {
          const jsFile = entry.files.find((file) => file === `${entrypoint.name}/index.js`);
          const fullJsPath = path.join(entry.dirname, jsFile ?? '');
          if (jsFile && !entrypoint.ignoreSources.includes(fullJsPath)) {
            result.js.push({
              component: `./${entry.name}/${jsFile}`,
              path: fullJsPath
            });
          }

          const scssFile = entry.files.find((file) => file === `${entrypoint.name}/index.scss`);
          const fullScssPath = path.join(self.buildRootSource, entry.dirname, scssFile ?? '');
          if (scssFile && !entrypoint.ignoreSources.includes(fullScssPath)) {
            result.scss.push({
              component: `./${entry.name}/${scssFile}`,
              path: fullScssPath
            });
          }
        }

        const extraSources = self.getExtraSourceFiles(entrypoint, meta);
        result.js.push(...extraSources.js);
        result.scss.push(...extraSources.scss);

        return result;
      },
      // FIXME: move to the core.
      // Get the component source files for entrypoint `apos: true`.
      // The `meta` array is the metadata for all source files passed to
      // the function. The function returns an object with `js` and
      // `scss` (for consistency) arrays, containing properties `component`
      // (relative path to the file from within the apos - build folder)
      // and `path` (full path to the file).
      getAposComponentSourceFiles(entrypoint, meta) {
        const result = {
          js: [],
          scss: []
        };
        if (!entrypoint.apos) {
          return result;
        }

        for (const entry of meta) {
          entry.files.filter((file) => file.startsWith(`${entrypoint.name}/components/`))
            .map((file) => ({
              component: `./${entry.name}/${file}`,
              path: path.join(entry.dirname, file)
            }))
            .forEach((item) => {
              result.js.push(item);
            });
        }

        // Reverse the list so we can easily find the last configured import
        // of a given component, allowing "improve" modules to win over
        // the originals when shipping an override of a Vue component
        // with the same name, and filter out earlier versions
        result.js.reverse();
        const seen = new Set();
        result.js = result.js.filter(item => {
          const name = self.apos.asset.getComponentNameForUI(item.component);
          if (seen.has(name)) {
            return false;
          }
          seen.add(name);
          return true;
        });
        // Put the result.js back in their original order
        result.js.reverse();

        return result;
      },
      // FIXME: move to the core.
      // Get the tiptap source files for entrypoint `apos: true`.
      // The `meta` array is the metadata for all source files passed to
      // the function. The function returns an object with `js` and
      // `scss` (for consistency) arrays, containing properties `component`
      // (relative path to the file from within the apos - build folder)
      // and `path` (full path to the file).
      getAposTiptapSourceFiles(entrypoint, meta) {
        const result = {
          js: [],
          scss: []
        };
        if (!entrypoint.apos) {
          return result;
        }

        for (const entry of meta) {
          entry.files.filter((file) => file.startsWith(`${entrypoint.name}/tiptap-extensions/`))
            .map((file) => ({
              component: `./${entry.name}/${file}`,
              path: path.join(entry.dirname, file)
            }))
            .forEach((item) => {
              result.js.push(item);
            });
        }

        return result;
      },
      // FIXME: move to the core.
      // Get the `app` source files for entrypoint `apos: true`.
      // The `meta` array is the metadata for all source files passed to
      // the function. The function returns an object with `js` and
      // `scss` (for consistency) arrays, containing properties `component`
      // (relative path to the file from within the apos - build folder)
      // and `path` (full path to the file).
      getAposAppSourceFiles(entrypoint, meta) {
        const result = {
          js: [],
          scss: []
        };
        if (!entrypoint.apos) {
          return result;
        }

        for (const entry of meta) {
          entry.files.filter((file) => file.startsWith(`${entrypoint.name}/apps/`))
            .map((file) => ({
              component: `./${entry.name}/${file}`,
              path: path.join(entry.dirname, file)
            }))
            .forEach((item) => {
              result.js.push(item);
            });
        }

        return result;
      },
      // FIXME: move to the core.
      // Get extra source files for the entrypoint. The `entrypoint.sources`
      // object is used to include extra files. `meta` is the metadata for all
      // source files passed to the function. The function returns an object
      // with `js` and `scss` arrays, containing properties `component` (relative
      // path to the file from within the apos-build folder) and `path` (full
      // path to the file).
      getExtraSourceFiles(entrypoint, meta) {
        const extraSources = entrypoint.sources;
        if (!extraSources.js.length && !extraSources.scss.length) {
          return [];
        }
        // Find the meta for extra source full path
        const result = {
          js: [],
          scss: []
        };
        for (const sourcePath of extraSources.js) {
          const source = findSource(sourcePath);
          if (source) {
            result.js.push(source);
          }
        }
        for (const sourcePath of extraSources.scss) {
          const source = findSource(sourcePath);
          if (source) {
            result.scss.push(source);
          }
        }

        return result;

        function findSource(sourcePath) {
          const entry = meta.find((entry) => sourcePath.includes(entry.dirname));
          if (!entry) {
            throw new Error(`No meta information for "${sourcePath}".`);
          }
          const component = sourcePath.replace(entry.dirname + '/', '');
          if (entry.files.includes(component)) {
            return {
              component: `./${entry.name}/${component}`,
              path: sourcePath
            };
          }
          return null;
        }
      },
      // FIXME: move to the core.
      // Write the entrypoint file in the build source folder. The expected
      // argument properties:
      // - importFile: The absolute path to the entrypoint file.
      // - prologue: The prologue string to prepend to the file.
      // - icon: The admin UI icon import code.
      // - components: The admin UI component import code.
      // - tiptap: The admin UI tiptap import code.
      // - app: The admin UI app import code.
      // - indexJs: The public index.js import code.
      // - indexSass: The public index.scss import code.
      async writeEntrypointFile({
        importFile,
        prologue,
        icon,
        components,
        tiptap,
        app,
        indexJs,
        indexSass
      }) {
        let output = prologue?.trim()
          ? prologue.trim() + '\n'
          : '';
        output += (indexSass && indexSass.importCode) || '';
        output += (indexJs && indexJs.importCode) || '';
        output += (icon && icon.importCode) || '';
        output += (components && components.importCode) || '';
        output += (tiptap && tiptap.importCode) || '';
        output += (app && app.importCode) || '';
        output += (icon && icon.registerCode) || '';
        output += (components && components.registerCode) || '';
        output += (tiptap && tiptap.registerCode) || '';
        output += app
          ? `if (document.readyState !== 'loading') {
  setTimeout(invoke, 0);
} else {
  window.addEventListener('DOMContentLoaded', invoke);
}
function invoke() {
  ${app.invokeCode.trim()}
}` + '\n'
          : '';
        output += (indexJs && indexJs.invokeCode.trim().split('\n').map(l => l.trim()).join('\n') + '\n') || '';

        await fs.writeFile(importFile, output);
      },
      async cleanUpBuildRoot() {
      }
    };
  }
};
