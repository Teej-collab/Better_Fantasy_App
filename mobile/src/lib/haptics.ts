import * as Haptics from 'expo-haptics';

// The app's haptic vocabulary, so every screen feels the same:
// `select` for picking an option (pills, tabs, toggles), `tap` for a
// primary action, `success` / `warning` / `error` for how it turned out,
// and `thud` for a heavier beat (the intro's lights). Never throws — a
// phone without a Taptic Engine just doesn't buzz.
const ignore = () => {};

export const haptics = {
  select: () => void Haptics.selectionAsync().catch(ignore),
  tap: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(ignore),
  thud: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(ignore),
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore),
  warning: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(ignore),
  error: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(ignore),
};
