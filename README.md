
<div align="center">
  <img src="https://raw.githubusercontent.com/apostrophecms/apostrophe/main/logo.svg" alt="ApostropheCMS logo" width="80" height="80">

  <h1>Apostrophe Vite Bundling And HMR</h1>
  <p>
    <a aria-label="Apostrophe logo" href="https://docs.apostrophecms.org">
      <img src="https://img.shields.io/badge/MADE%20FOR%20ApostropheCMS-000000.svg?style=for-the-badge&logo=Apostrophe&labelColor=6516dd">
    </a>
    <a aria-label="Join the community on Discord" href="http://chat.apostrophecms.org">
      <img alt="" src="https://img.shields.io/discord/517772094482677790?color=5865f2&label=Join%20the%20Discord&logo=discord&logoColor=fff&labelColor=000&style=for-the-badge&logoWidth=20">
    </a>
    <a aria-label="License" href="https://github.com/apostrophecms/vite/blob/main/LICENSE.md">
      <img alt="" src="https://img.shields.io/static/v1?style=for-the-badge&labelColor=000000&label=License&message=MIT&color=3DA639">
    </a>
  </p>
</div>

This bundle offers a bundling and hot module reloading setup for ApostropheCMS projects using Vite.

## Installation

To install the module, use the command line to run this command in an Apostrophe project's root directory:

```
npm install @apostrophecms/vite
```

## Usage

Add the module in the `app.js` file:

```javascript
require('apostrophe')({
  shortName: 'my-project',
  modules: {
    '@apostrophecms/vite': {},
  }
});
```

## Configuration

HMR is enabled for the project UI code by default. The module is controlled with the core asset options (no module options are available).

## Switch to Apostrophe Admin UI HMR

```javascript
require('apostrophe')({
  shortName: 'my-project',
  modules: {
    '@apostrophecms/vite': {},
    '@apostrophecms/asset': {
      options: {
        hmr: 'apos', // set to `public` to go back to the default behavior
      },
    },
  }
});
```

## Disable the HMR and the Vite development server

```javascript
require('apostrophe')({
  shortName: 'my-project',
  modules: {
    '@apostrophecms/vite': {},
    '@apostrophecms/asset': {
      options: {
        hmr: false,
      },
    },
  }
});
```

## Change the underlying Websocket server port

By default the websocket server runs on the same port as the ApostropheCMS server. If you want to change the port and switch the development server to a standalon `http` server, you can do so by setting the `hmrPort` option:

```javascript
require('apostrophe')({
  shortName: 'my-project',
  modules: {
    '@apostrophecms/vite': {},
    '@apostrophecms/asset': {
      options: {
        hmrPort: 3001,
      },
    },
  }
});
```

## Expose sourcemaps in production

It's possible to release the sourcemap files in production if you want to debug the production build and see the original source code in the browser devtools.

```javascript
require('apostrophe')({
  shortName: 'my-project',
  modules: {
    '@apostrophecms/vite': {},
    '@apostrophecms/asset': {
      options: {
        productionSourceMaps: true,
      },
    },
  }
});
```

## Inject code only when HMR is enabled

If you want to inject some code in your site only when in development mode and HMR is enabled, you can use the Apostrophe nunjucks components. 

```njk
{# module-name/views/myComponent.html #}
<!-- Shown only when HMR is enabled and in development mode. -->
```

```js
// module-name/index.js
module.exports = {
  components(self) {
    return {
      myComponent(req, data) {
        return {};
      }
    };
  },
  init(self) {
    self.apos.template.prepend({
      where: 'head',
      when: 'hmr',
      bundler: 'vite',
      component: 'module-name:myComponent'
    });
  }
};
```
You can also use `when: 'dev'` and `when: 'prod'` to show the component only in development or production mode respectively. `bundler: 'vite'` ensures that the component is only shown when the Vite bundler is used.

## Extend the Vite configuration

Two ways of doing it:
- Module `build.vite` property
- Project root `apos.vite.config.js` (when ESM project) or `apos.vite.config.mjs` (when CJS project)

### Module `build.vite` property

```javascript
// my-module/index.js
module.exports = {
  build: {
    vite: {
      myViteConfig: {
        // Standard Vite configuration
        define: {
        __MY_ENV__: '1',
        },
      }
    },
  },
};
```

### Project root `apos.vite.config.js` or `apos.vite.config.mjs`

The exactly same configuration as in the Vite documentation can be used. It applies (again) only to the project UI build. 

Example of adding a standard vite plugin to the Vite configuration:

```javascript
// apos.vite.config.js
// `vite` can be imported from the module
import { defineConfig } from '@apostrophecms/vite/vite';
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [ vue() ]
});
```

## Limitations

- HMR watches only existing `anyModule/ui` directories, so if you add a `ui` directory to a module, you need to restart the server (type `rs` in the terminal and press `Enter` if you are using `nodemon` which is by default in ApostropheCMS starter kits) to make HMR work for the new module.
- changes to `ui/public` does not trigger HMR and/or page reload, because those require a process restart. This might be implemented in the future (or might not, depending on the needs). A workaround is to register all `ui/public/` folders to the `nodemon` watch list (in the `nodemon.json` or `package.json` file, depending on the setup).
- when configuring custom Vite `resolve.alias`, it should resolve to the appropraite `apos-build/...` source code, not the original source code. We should provide a way to do that (e.g. template `{srcRoot}` that will be replaced when we merge the configuration or argument `aposRoot` if a function is used).

## Watch out in your code
- Remove all `~` from your CSS/Sass imports (e.g. `~normalize.css` -> `normalize.css`)
- **(recommended but not required)** Do not import apos sources directly from the `apostrophe/modules/module-name/ui/apos/components/...` but use the alias `Modules/module-name/components/...` instead. The alias is available only in the `apos` source code. Project code can introduce its own aliases.
- Do not use any `cjs` imports/exports (`require(..)`, `module.exports`, `exports.xxx`) in your UI source code, only `esm` imports and exports (`import abc from xxx` or `const abc = await import(xxx)`, `export default ...`, `export something`) are supported.
