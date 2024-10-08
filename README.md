
<div align="center">
  <img src="https://raw.githubusercontent.com/apostrophecms/apostrophe/main/logo.svg" alt="ApostropheCMS logo" width="80" height="80">

  <h1>ApostropheCMS Vite Bundling And HMR</h1>
  <p>
    <a aria-label="Apostrophe logo" href="https://v3.docs.apostrophecms.org">
      <img src="https://img.shields.io/badge/MADE%20FOR%20ApostropheCMS-000000.svg?style=for-the-badge&logo=Apostrophe&labelColor=6516dd">
    </a>
    <a aria-label="License" href="https://github.com/apostrophecms/module-template/blob/main/LICENSE.md">
      <img alt="" src="https://img.shields.io/static/v1?style=for-the-badge&labelColor=000000&label=License&message=MIT&color=3DA639">
    </a>
  </p>
</div>

This bundle offers a bundling and hot module reloading setup for ApostropheCMS projects using Vite.

## Installation

To install the module, use the command line to run this command in an Apostrophe project's root directory:

```
// TBD
npm install 
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
