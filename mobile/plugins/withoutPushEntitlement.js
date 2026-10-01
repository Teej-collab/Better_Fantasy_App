// expo-notifications always adds the `aps-environment` (Push
// Notifications) entitlement. A free Apple developer account can't sign
// that, and the app doesn't need it yet: its reminders are local
// notifications scheduled on the phone (src/lib/localNotifications.ts),
// which need no entitlement. Remove this plugin once the app has a paid
// Apple developer account and real push.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
