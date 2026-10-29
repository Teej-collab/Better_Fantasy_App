// Expo SDK 57's Podfile pulls in prebuilt ExpoModulesCore frameworks by
// default, and those are compiled with one exact Swift version (6.3.1).
// A newer Xcode can't load them (Xcode 27.1 / Swift 6.4, 2026-10-29:
// "Failed to build module 'ExpoModulesCore'; this SDK is not supported
// by the compiler"), so the archive fails. This sets the Podfile
// property the generated Podfile reads to turn them off, so Expo's
// modules build from source with whatever Xcode is installed. Builds
// take a little longer.
const { withPodfileProperties } = require('expo/config-plugins');

module.exports = function withSourceBuiltExpoModules(config) {
  return withPodfileProperties(config, (cfg) => {
    cfg.modResults.EXPO_USE_PRECOMPILED_MODULES = 'false';
    return cfg;
  });
};
