// expo-sharing adds the share extension target (expo-sharing-extension)
// but doesn't give it app.json's ios.appleTeamId, so Xcode refuses to
// sign it ("requires a development team") after every
// `npx expo prebuild`. This sets the team on that target's build
// configurations.
//
// Listed BEFORE expo-sharing in app.json: Xcode-project mods run in
// reverse order, so this one runs after the target exists.
const { withXcodeProject } = require('expo/config-plugins');

const TARGET_BUNDLE_SUFFIX = '.expo-sharing-extension';

module.exports = function withShareExtensionTeam(config) {
  return withXcodeProject(config, (cfg) => {
    const team = cfg.ios?.appleTeamId;
    if (!team) return cfg;
    const configurations = cfg.modResults.pbxXCBuildConfigurationSection();
    let found = 0;
    for (const entry of Object.values(configurations)) {
      const settings = entry?.buildSettings;
      const bundleId = String(settings?.PRODUCT_BUNDLE_IDENTIFIER ?? '').replace(/"/g, '');
      if (!bundleId.endsWith(TARGET_BUNDLE_SUFFIX)) continue;
      settings.DEVELOPMENT_TEAM = team;
      found++;
    }
    if (found === 0) {
      console.warn('withShareExtensionTeam: no expo-sharing-extension build configurations found; is the plugin listed before expo-sharing?');
    }
    return cfg;
  });
};
