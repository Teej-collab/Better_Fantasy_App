import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TurboModuleRegistry, View } from 'react-native';
import type { WebView as WebViewType } from 'react-native-webview';

import { MessageState } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { WEB_BASE_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// The browser's native code arrived in iOS build 7; older builds get
// the same over-the-air JavaScript, so it's only loaded where it's
// installed (see components/bets/BetLinkReader.tsx).
const WebView: typeof WebViewType | null = TurboModuleRegistry.get('RNCWebViewModule')
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native-webview').WebView
  : null;

// The Brain: the website's live system map (frontend/src/app/brain/route.ts), signed
// in with the app's own session: the page and its 15-second status checks
// both read the website's `session` cookie, set here before the page
// loads. Site admins only; the website shows anyone else "Not found".
export default function AdminBrain() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const url = `${WEB_BASE_URL}/brain`;

  let body: React.ReactNode;
  if (!WebView) body = <MessageState message="This build can't show web pages yet. Open weekend-league-web.vercel.app/brain in Safari instead." />;
  else if (!token || !WEB_BASE_URL) body = <MessageState message="Sign in to see the Brain." />;
  else {
    // A first request's Cookie header isn't reliably sent by iOS's web
    // view, so a blank page on the website's own origin sets the cookie
    // and then opens the map.
    const cookie = `session=${token}; path=/; secure; samesite=lax`;
    const start = `<script>document.cookie = ${JSON.stringify(cookie)}; location.replace(${JSON.stringify(url)});</script>`;
    body = (
      <>
        <WebView
          source={{ html: start, baseUrl: WEB_BASE_URL }}
          style={styles.web}
          onLoadEnd={(e) => {
            if (e.nativeEvent.url.startsWith(url)) setLoading(false);
          }}
          originWhitelist={['https://*', 'about:*']}
        />
        {loading && (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator color={Colors.text} />
          </View>
        )}
      </>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Brain' }} />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#06080d' },
  web: { flex: 1, backgroundColor: '#06080d' },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
