module.exports = {
  bundle: {
    directory: 'modules',
    modules: [ 'rich-text-color', 'rich-text-font' ]
  },
  i18n: {
    aposRichTextEnhancement: {
      browser: true
    }
  },
  init(self) {
    console.log('👋 from the rich text widget enhancement!');
  }
};
