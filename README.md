
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

TODO: Documentation

## Limitations

- HMR watches only existing `anyModule/ui` directories, so if you add a `ui` directory to a module, you need to restart the server (type `rs` in the terminal and press `Enter` if you are using `nodemon` which is by default in ApostropheCMS starter kits) to make HMR work for the new module.
- changes to `ui/public` does not trigger HMR and/or page reload, because those require a process restart. This might be implemented in the future (or might not, depending on the needs). A workaround is to register all `ui/public/` folders to the `nodemon` watch list (in the `nodemon.json` or `package.json` file, depending on the setup).

## Watch out in your code
- Remove all `~` from your CSS/Sass imports (e.g. `~normalize.css` -> `normalize.css`)
- **(recommended but not required)** Do not import apos sources directly from the `apostrophe/modules/module-name/ui/apos/components/...` but use the alias `Modules/module-name/components/...` instead.
- Do not use any `cjs` imports/exports (`require(..)`, `module.exports`, `exports.xxx`) in your UI source code, only `esm` imports (`import abc from xxx` or `const abc await import(xxx)`) are supported.
