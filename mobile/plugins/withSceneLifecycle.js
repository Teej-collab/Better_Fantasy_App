// iOS 27 refuses to launch an app that hasn't adopted the UIScene life
// cycle (the launch crash is UIKit's
// _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
// Expo ships the scene delegate for this (expo's ExpoAppSceneDelegate,
// ObjC name EXExpoAppSceneDelegate) but this SDK's prebuild template
// doesn't switch it on yet, so this plugin does, every time
// `npx expo prebuild` regenerates ios/:
//   - Info.plist gets a UIApplicationSceneManifest pointing at it.
//   - AppDelegate stops creating its own window (the scene delegate
//     creates it and starts React Native into it) and conforms to
//     ExpoReactNativeFactoryProvider, which the scene delegate needs.
const fs = require('fs');
const path = require('path');
const { withAppDelegate, withDangerousMod, withInfoPlist } = require('expo/config-plugins');

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle expects a Swift AppDelegate');
    }
    let src = cfg.modResults.contents;
    if (src.includes('ExpoReactNativeFactoryProvider')) return cfg;

    const classLine = 'class AppDelegate: ExpoAppDelegate {';
    const windowBlock = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;
    if (!src.includes(classLine) || !src.includes(windowBlock)) {
      throw new Error('withSceneLifecycle: AppDelegate.swift no longer matches the expected template — update the plugin');
    }
    src = src.replace(classLine, 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    src = src.replace(
      windowBlock,
      '    // The window is created by the scene delegate (EXExpoAppSceneDelegate),\n' +
        '    // which starts React Native into it — see plugins/withSceneLifecycle.js.\n',
    );
    cfg.modResults.contents = src;
    return cfg;
  });
}

// Xcode's Run button builds the scheme's Launch configuration. Release
// embeds the JS bundle, so the app on the phone runs without Metro on
// the Mac. Use
// `npx expo start` + Expo Go for live-reload development instead.
function withReleaseRunScheme(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const project = fs.readdirSync(root).find((f) => f.endsWith('.xcodeproj'));
      const schemes = path.join(root, project, 'xcshareddata', 'xcschemes');
      if (fs.existsSync(schemes)) {
        for (const file of fs.readdirSync(schemes).filter((f) => f.endsWith('.xcscheme'))) {
          const p = path.join(schemes, file);
          const xml = fs.readFileSync(p, 'utf8');
          fs.writeFileSync(p, xml.replace(/(<LaunchAction\s+buildConfiguration = ")Debug(")/, '$1Release$2'));
        }
      }
      return cfg;
    },
  ]);
}

module.exports = function withSceneLifecycle(config) {
  return withReleaseRunScheme(withSceneAppDelegate(withSceneManifest(config)));
};
