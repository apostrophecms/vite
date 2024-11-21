
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

This extension provides Vite integration for ApostropheCMS projects, enabling module bundling and hot module replacement (HMR) during development.

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

## Hot Module Replacement Configuration

By default, HMR is enabled for your project's public UI code. All configuration is handled through ApostropheCMS's core asset module options, simplifying setup and maintenance.

### Enable Admin UI HMR

For development work on the ApostropheCMS admin interface, you can switch HMR to target the admin UI instead of public-facing components:

```javascript
require('apostrophe')({
  shortName: 'my-project',
  modules: {
    '@apostrophecms/vite': {},
    '@apostrophecms/asset': {
      options: {
        hmr: 'apos', // 'public' targets the project UI (default)
      },
    },
  }
});
```

### Disable HMR

You can disable hot module replacement when it is not needed or desired, while still using Vite for builds:

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
During development, the hot module reload (HMR) server uses WebSocket and runs on the same port as your ApostropheCMS instance. For advanced configurations, you can run the development server as a standalone HTTP server on a different port by setting the `hmrPort` option. This can be useful when you need to avoid port conflicts or work with specific network configurations:

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

## Enable Source Maps in Production

You can enable source maps in production to help debug minified code and view original source files in the browser DevTools. While this slightly increases the initial download size, it's valuable for debugging production issues.

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
The when option controls when your component appears:

```javascript
when: 'hmr'   // Only visible when HMR is active
when: 'dev'   // Visible in any development mode
when: 'prod'  // Only visible in production
```

The bundler option allows you to specify which bundler must be active for the component to appear:

```javascript
bundler: 'vite'    // Only visible when using Vite
bundler: 'webpack' // Only visible when using webpack
```

You can combine these options to precisely control when your component appears. For example, to show a component only when using Vite with HMR active, you would use both `when: 'hmr'` and `bundler: 'vite'`.

## Provided Vite Configuration

While the `apos` build (the code living in every module `ui/apos` directory) is fully preconfigured and doesn't allow for customization, the `public` build (the code imported within `ui/src/` ) is fully customizable and contains a minimal configuration to get you started:
- A PostCSS plugin to handle core features as "Breakpoint Preview" (when enabled)
- `Modules/` alias to simplify module within the same build 
- `@/` alias to allow easy access to cross-module and cross-build source code

### Pre-configured Aliases

`Modules/` alias is available for both public and admin UI builds and allows you to import modules in your project without worrying about the relative path, but restricts you to only sources inside of `ui/src` directories.

```javascript
// Current file: modules/another-module/ui/src/index.js
// Actual import path: modules/my-module/ui/src/lib/utils.js
import utils from 'Modules/my-module/lib/utils.js';
```

`@/` alias is available for both public and admin UI builds and allows you to import files from the entire project source code.

```javascript
// Current file: any file in any module inside of the `ui/` folder
// Actual path: modules/my-module/ui/src/lib/utils.js
import utils from '@/modules/my-module/src/lib/utils.js';

// Actual path: modules/my-module/ui/apos/mixins/SomeMixin.js
import SomeMixin from '@/modules/my-module/apos/mixins/SomeMixin.js';
```

> Warning: You gain access to `public` builds from within the `apos` build, and vice versa, when using the `@/` alias. You should use it with caution, because it might lead to situations where imports are not resolved correctly. This would happen if the imported file (or its deep imports) contains `Modules/` aliased imports. In other hand `@/` is more developer friendly, allows auto-completion and is more intuitive and readable. Be sure to include mostly sources from your current build and ensure no imported sources contain `Modules/` aliased imports when cross-importing from another build.

## Configuring Your Code Editor

Every editor, that understands the `jsconfig.json` or `tsconfig.json` file, can be configured to understand the `@/` alias provided by this module. Here is an example of a `jsconfig.json` file that you can place in your project root:

```json
{
  "compilerOptions": {
    "baseUrl": "./apos-build/@apostrophecms/vite/default",
    "paths": {
      "@/*": ["./src/*"]
    },
    "module": "ESNext",
    "moduleResolution": "bundler"
  },
  "exclude": [
    "apos-build/@apostrophecms/vite/default/dist",
    "node_modules",
    "public",
    "data"
  ]
}
```

> Note: If you change your project asset namespace you have to adjust the `baseUrl` and `exclude` path accordingly. For example, if your project namespace is `my-namespace`, the `baseUrl` should be `./apos-build/@apostrophecms/vite/my-namespace` and the `exclude` path - `apos-build/@apostrophecms/vite/my-namespace/dist`.

## Extending the Vite Configuration

You can customize the Vite configuration for your ApostropheCMS project in two ways:

### 1. Via Any Module `build.vite` Property

Use this approach to configure Vite settings within individual ApostropheCMS modules:

```javascript
// modules/my-module/index.js
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

### 2. Via Project Configuration File

For project-wide Vite configuration, create one of these files in your project root:
- `apos.vite.config.js` (for ESM projects)
- `apos.vite.config.mjs` (for CommonJS projects)

This method supports the full Vite configuration API and applies to your project's UI build. You can import Vite's configuration utilities directly from the ApostropheCMS Vite module:

```javascript
// apos.vite.config.js
import { defineConfig } from '@apostrophecms/vite/vite';
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [ vue() ]
});
```

The configuration format follows the standard [Vite configuration options](https://vitejs.dev/config/). Common use cases include adding plugins, defining environment variables, and customizing build settings.

> Note: All Vite configurations are merged sequentially - first across modules (following module registration order, with later modules taking precedence), and finally with the project configuration file, which takes ultimate precedence.

## Limitations and Known Issues

### Hot Module Replacement
- HMR only monitors existing `anyModule/ui` directories. If you add a new `ui` directory to a module, restart the server to enable HMR for that module. With default ApostropheCMS starter kits using `nodemon`, simply type `rs` in the terminal and press Enter.
- The `apos` HMR won't work when the `public` build contains Vue sources (transformed by the `@vitejs/plugin-vue` plugin). The HMR for the `public` build should still work as expected. The problem is related to the fact that the page would contains two Vue instances (core and reactive) instances, which is not currently supported. We are researching solutions to this issue.

### Public Assets
- Changes to `ui/public` directories don't trigger HMR or page reloads as they require a process restart
- Workaround: Add `ui/public/` folders to your `nodemon` watch list in either `nodemon.json` or `package.json`
- Future support for this feature will depend on user needs

### Vite Alias Resolution
- When setting custom `resolve.alias` in Vite configuration, paths must resolve to the appropriate `apos-build/...` source code rather than the original source
- Future enhancement planned: We will provide templating (e.g., `{srcRoot}`) or function arguments (e.g., `aposRoot`) to simplify correct path resolution

## Code Migration Guidelines

### Import Paths
- Remove all `~` prefixes from CSS/Sass imports
  ```css
  /* Instead of: @import "~normalize.css" */
  @import "normalize.css"
  ```

### ApostropheCMS Module Imports
- **Recommended**: Use the `Modules/module-name/components/...` alias instead of direct paths like `apostrophe/modules/module-name/ui/apos/components/...`
- This alias is available only for `apos` source code; project code can define its own aliases

### Module System
- Use only ESM syntax in UI source code:
  - ✅ `import abc from 'xxx'` or `const abc = await import('xxx')`
  - ✅ `export default ...` or `export something`
  - ❌ No CommonJS: `require()`, `module.exports`, `exports.xxx`
