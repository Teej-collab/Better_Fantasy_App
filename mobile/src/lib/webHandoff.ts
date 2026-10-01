import * as WebBrowser from 'expo-web-browser';

import { Colors } from '@/constants/theme';
import { api, WEB_BASE_URL } from '@/lib/api';

// Opens a page of the web app in the in-app browser, already signed in.
// Used for the Watch Party and Lounge video calls: LiveKit's video SDK
// needs a native build, which Expo Go can't run, while the browser
// handles camera, mic and screen share on its own. The backend mints a
// single-use, 60-second ticket for this session (POST
// /auth/native/web-handoff), and the web's /auth/native-complete page
// redeems it, sets its own cookie, then goes on to `path`.
export async function openSignedInWeb(path: string): Promise<void> {
  let url = `${WEB_BASE_URL}${path}`;
  try {
    const { ticket } = await api.webHandoff();
    url = `${WEB_BASE_URL}/auth/native-complete?ticket=${encodeURIComponent(ticket)}&next=${encodeURIComponent(path)}`;
  } catch {
    // Still open the page; the web shows its own sign-in if it needs one.
  }
  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
    controlsColor: Colors.accent,
    dismissButtonStyle: 'done',
  });
}
