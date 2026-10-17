import { useEffect, useRef } from 'react';
import { StyleSheet, TurboModuleRegistry, useWindowDimensions, View } from 'react-native';
import type { WebView as WebViewType } from 'react-native-webview';

// Opens a sportsbook's shared-bet link (DraftKings' Share button sends a
// link, not a picture) in an invisible browser on the phone and hands
// back the page's text once the bet has drawn. The page builds the bet
// with its own JavaScript after it loads, so the link alone has nothing
// to read. Opening it here, on the bettor's phone where the book is legal,
// looks like any other visit; from our server it would look like a bot.

const GIVE_UP_MS = 20_000;

// The browser's native code arrived in iOS build 7. Older builds get the
// same over-the-air JavaScript, and importing the package there throws,
// so it's only loaded where it's installed; elsewhere the link just fails
// over to "share a screenshot".
const WebView: typeof WebViewType | null = TurboModuleRegistry.get('RNCWebViewModule')
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native-webview').WebView
  : null;

// Runs inside the page: waits for text that looks like a bet (a dollar
// amount or American odds) to stop changing, then posts it. Posts
// whatever is there after 15s.
const WATCH_PAGE = `(() => {
  const started = Date.now();
  let last = '';
  let steady = 0;
  const looksLikeBet = (t) => /\\$\\s?\\d/.test(t) && /[+\\u2212-]\\d{3,}/.test(t);
  const send = (text) => window.ReactNativeWebView.postMessage(JSON.stringify({ text }));
  const tick = () => {
    const text = (document.body && document.body.innerText) || '';
    steady = text === last ? steady + 1 : 0;
    last = text;
    if ((looksLikeBet(text) && steady >= 2) || Date.now() - started > 15000) return send(text);
    setTimeout(tick, 500);
  };
  tick();
})();
true;`;

export function BetLinkReader({ url, onText, onFail }: { url: string; onText: (text: string) => void; onFail: () => void }) {
  const { width, height } = useWindowDimensions();
  const done = useRef(false);
  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  useEffect(() => {
    done.current = false;
    if (!WebView) {
      onFail();
      return;
    }
    const timer = setTimeout(() => finish(onFail), GIVE_UP_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (!WebView) return null;
  return (
    <View pointerEvents="none" style={[styles.hidden, { width, height }]} importantForAccessibility="no-hide-descendants">
      <WebView
        key={url}
        source={{ uri: url }}
        // Starts as the page opens rather than after its ad trackers finish.
        injectedJavaScriptBeforeContentLoaded={WATCH_PAGE}
        onMessage={(e) => {
          let text = '';
          try {
            text = String(JSON.parse(e.nativeEvent.data).text ?? '').trim();
          } catch {
            // Not ours.
            return;
          }
          finish(() => (text.length >= 40 ? onText(text) : onFail()));
        }}
        onError={() => finish(onFail)}
        onHttpError={(e) => {
          if (e.nativeEvent.statusCode >= 400) finish(onFail);
        }}
        // The page's "open in the app" links (dksb://…) and pop-ups stay put.
        onShouldStartLoadWithRequest={(req) => /^https?:/i.test(req.url)}
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        allowsInlineMediaPlayback={false}
        mediaPlaybackRequiresUserAction
        incognito
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', left: 0, top: 0, opacity: 0, zIndex: -1 },
});
