# Changelog

## UNRELEASED

### Adds

* Adds postcss supports for the new `postcss-viewport-to-container-toggle` that allows the breakpoint preview feature to work.
* Loads postcss config file from project only for public builds.
* Adds `autoprefixer` plugin only for apos builds.
* Adds module debug logs when in asset debug mode (`APOS_ASSET_DEBUG=1`).
* Adds an option for disabling the module preload polyfill.
* Adds support for `synthetic` entrypoints, that will only process the entrypoint `prologue`.
* Adds support for `Modules/...` alias for the public builds (Webpack BC). 
* Our Vite alias plugin now throws with an useful error message when `Modules/` alias resolver fails.

### Fixes

* Don't crash when there is no entrypoint of type `index`.

## 1.0.0-beta.1 (2024-10-31)

* Initial beta release.
