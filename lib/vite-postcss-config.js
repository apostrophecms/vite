const path = require('node:path');
const fs = require('node:fs');
const postcssViewportToContainerToggle = require('postcss-viewport-to-container-toggle');

module.exports = async (configEnv, assetOptions, util) => {
  const postCssConfigPath = path.resolve(process.cwd(), 'postcss.config.js');

  const importedConfig = fs.existsSync(postCssConfigPath)
    ? await import(postCssConfigPath)
    : {};

  const {
    plugins = [],
    ...postCssConfig
  } = importedConfig.default || importedConfig;

  if (!Array.isArray(plugins)) {
    util.error('WARNING: postcss.config.js must export an array of plugins');
  }

  return {
    css: {
      postcss: {
        plugins: [
          ...assetOptions.breakpointPreviewMode?.enable === true
            ? [
              postcssViewportToContainerToggle({
                modifierAttr: 'data-breakpoint-preview-mode',
                debug: assetOptions.breakpointPreviewMode?.debug === true,
                transform: assetOptions.breakpointPreviewMode?.transform
              })
            ]
            : [],
          ...Array.isArray(plugins) ? plugins : []
        ],
        ...postCssConfig
      }
    }
  };
};
