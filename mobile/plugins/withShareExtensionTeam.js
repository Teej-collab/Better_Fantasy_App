// expo-sharing adds the share extension target (expo-sharing-extension)
// but doesn't give it app.json's ios.appleTeamId, so Xcode refuses to
// sign it ("requires a development team") after every
// `npx expo prebuild`; and it names it "expo-sharing-extension", which
// is what the share sheet shows. This sets the team on that target's
// build configurations and names it after the app.
//
// Listed BEFORE expo-sharing in app.json: mods run in reverse order, so
// these run after the target and its files exist.
const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist').default;
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const TARGET_NAME = 'expo-sharing-extension';

function withShareExtensionName(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, TARGET_NAME, 'Info.plist');
      if (!fs.existsSync(file)) {
        console.warn(`withShareExtensionTeam: ${file} not found; is the plugin listed before expo-sharing?`);
        return cfg;
      }
      const info = plist.parse(fs.readFileSync(file, 'utf8'));
      info.CFBundleDisplayName = cfg.name;
      fs.writeFileSync(file, plist.build(info));
      return cfg;
    },
  ]);
}

const TARGET_BUNDLE_SUFFIX = '.expo-sharing-extension';

function withTeam(config) {
  return withXcodeProject(config, (cfg) => {
    const team = cfg.ios?.appleTeamId;
    const configurations = cfg.modResults.pbxXCBuildConfigurationSection();
    let found = 0;
    for (const entry of Object.values(configurations)) {
      const settings = entry?.buildSettings;
      const bundleId = String(settings?.PRODUCT_BUNDLE_IDENTIFIER ?? '').replace(/"/g, '');
      if (!bundleId.endsWith(TARGET_BUNDLE_SUFFIX)) continue;
      if (team) settings.DEVELOPMENT_TEAM = team;
      // Xcode's own copy of the name (General > Display Name), so it
      // agrees with the Info.plist set below.
      settings.INFOPLIST_KEY_CFBundleDisplayName = JSON.stringify(cfg.name);
      found++;
    }
    if (found === 0) {
      console.warn('withShareExtensionTeam: no expo-sharing-extension build configurations found; is the plugin listed before expo-sharing?');
    }
    return cfg;
  });
}

module.exports = function withShareExtensionTeam(config) {
  return withShareExtensionName(withTeam(config));
};
