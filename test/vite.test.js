const assert = require('node:assert/strict');
const t = require('apostrophe/test-lib/util.js');

const getAppConfig = () => {
  return {
    '@apostrophecms/express': {
      options: {
        session: { secret: 'supersecret' }
      }
    },
    '@apostrophecms/vite': {
      options: {
        alias: 'vite'
      }
    }
  };
};

describe('@apostrophecms/vite', function () {
  let apos;

  this.timeout(t.timeout);

  after(function () {
    return t.destroy(apos);
  });

  before(async function() {
    apos = await t.create({
      root: module,
      testModule: true,
      autoBuild: false,
      modules: getAppConfig()
    });
  });

  describe('init', function() {
    it('should have vite enabled', function () {
      const actual = Object.keys(apos.modules).includes('@apostrophecms/vite');
      const expected = true;

      assert.equal(actual, expected);
      assert.equal(apos.asset.getBuildModuleAlias(), 'vite');
      assert.equal(apos.asset.getBuildModuleConfig().name, '@apostrophecms/vite');
    });
  });

  describe('build', function() {
    it('should copy files', async function() {
      await apos.vite.build();
    });
  });
});
