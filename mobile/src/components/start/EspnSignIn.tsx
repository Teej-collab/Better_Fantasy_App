import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, TurboModuleRegistry, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WebView as WebViewType } from 'react-native-webview';

import { Text } from '@/components/Text';
import { Colors, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

// Sign in with ESPN (2026-10-27): ESPN's own login page in a sheet, so a
// private league connects without anyone digging up cookies. The person
// signs in on ESPN's page (password, captcha and email codes stay
// between them and ESPN; we never see the password), then we read the
// two cookies ESPN's own login page reads with document.cookie (espn_s2
// and SWID, neither HttpOnly) and nothing else. They then tap their
// league on ESPN Fantasy and its leagueId comes from the address. The
// browser is incognito, so the ESPN session isn't kept on the phone.

export type EspnSession = { espnS2: string; swid: string; leagueId: string | null };

// fantasy.espn.com/football/ itself is a 404 on mobile (a test sign-in
// landed there, 2026-10-27); the football hub lists your teams.
const FANTASY_HOME = 'https://www.espn.com/fantasy/football/';
const LOGIN_URL = `https://www.espn.com/login?redirect=${encodeURIComponent(FANTASY_HOME)}`;

// Same guard as BetLinkReader: the browser's native code arrived in iOS
// build 7, and importing it on an older build throws.
const WebView: typeof WebViewType | null = TurboModuleRegistry.get('RNCWebViewModule')
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native-webview').WebView
  : null;

export const espnSignInAvailable = WebView !== null;

// Runs in every ESPN page: posts the two cookies and the address when
// they change. Only those two cookies ever leave the page.
const WATCH = `(() => {
  if (window.__weekendEspn) return;
  window.__weekendEspn = true;
  let last = '';
  const read = (name) => ((new RegExp('(?:^|; )' + name + '=([^;]+)')).exec(document.cookie) || [])[1] || null;
  // Fantasy football team links on the page: ESPN's profile menu lists
  // your teams under Following.
  const teams = () => {
    const seen = {};
    const out = [];
    document.querySelectorAll('a[href*="leagueId="]').forEach((a) => {
      const m = /football.*[?&]leagueId=(\\d+)/i.exec(a.href);
      const name = (a.innerText || a.getAttribute('aria-label') || '').trim().split('\\n')[0];
      if (m && name && !seen[m[1]]) {
        seen[m[1]] = true;
        out.push({ leagueId: m[1], name: name.slice(0, 60) });
      }
    });
    return out;
  };
  const tick = () => {
    const msg = JSON.stringify({ s2: read('espn_s2'), swid: read('SWID'), url: location.href, teams: teams() });
    if (msg !== last) {
      last = msg;
      window.ReactNativeWebView.postMessage(msg);
    }
  };
  tick();
  setInterval(tick, 800);
})();
true;`;

const ESPN_PAGE = /^https:\/\/([a-z0-9-]+\.)*(espn\.com|go\.com|disney\.com)(\/|$)/i;

// Any ESPN football link with a league in it: a team, the league page,
// the ESPN app's own universal links.
function leagueIdFrom(url: string): string | null {
  return /espn\.com\/.*football.*[?&]leagueId=(\d+)/i.exec(url)?.[1] ?? null;
}

export function EspnSignIn({ visible, onDone, onClose }: { visible: boolean; onDone: (session: EspnSession) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [cookies, setCookies] = useState<{ s2: string; swid: string } | null>(null);
  const [teams, setTeams] = useState<{ leagueId: string; name: string }[]>([]);
  // The cookies for the link handler, which can't wait for a render.
  const session = useRef<{ s2: string; swid: string } | null>(null);
  // Where the sheet is, shown under the banner, and whether ESPN sent an
  // error page — a test sign-in hit "page not found" (2026-10-27), and
  // this is what tells us which step.
  const [address, setAddress] = useState('');
  const [failed, setFailed] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const finished = useRef(false);
  const web = useRef<WebViewType>(null);
  const signedIn = useRef(false);
  const onMissingPage = useRef(false);

  // Signed in but sitting on a missing page: go to the fantasy hub.
  const toHub = () => {
    onMissingPage.current = false;
    setFailed(null);
    web.current?.injectJavaScript(`location.replace(${JSON.stringify(FANTASY_HOME)}); true;`);
  };

  const finish = (session: EspnSession) => {
    if (finished.current) return;
    finished.current = true;
    haptics.success();
    onDone(session);
  };

  const reset = () => {
    finished.current = false;
    signedIn.current = false;
    onMissingPage.current = false;
    setCookies(null);
    setTeams([]);
    session.current = null;
    setFailed(null);
    setAddress('');
    setLoading(true);
  };

  const startOver = () => {
    reset();
    setAttempt((n) => n + 1);
  };

  if (!WebView) return null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onShow={reset}>
      <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={styles.barButton}>
            <Text style={styles.barText}>Cancel</Text>
          </Pressable>
          <Text style={styles.barTitle}>Sign in with ESPN</Text>
          <Pressable
            onPress={() => cookies && finish({ espnS2: cookies.s2, swid: cookies.swid, leagueId: null })}
            disabled={!cookies}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ disabled: !cookies }}
            style={styles.barButton}>
            <Text style={[styles.barText, styles.barDone, !cookies && styles.dim]}>Done</Text>
          </Pressable>
        </View>
        <View style={[styles.banner, cookies && styles.bannerOn, failed !== null && !cookies && styles.bannerError]} accessibilityLiveRegion="polite">
          <Text style={[styles.bannerText, cookies && styles.bannerTextOn]}>
            {cookies
              ? teams.length > 0
                ? "You're signed in. Pick your league:"
                : "You're signed in. Tap the profile icon at the top right, then your team under Following."
              : failed !== null
                ? `ESPN sent back an error page (${failed}). Tap Start over and try again.`
                : "Sign in on ESPN's own page. The Weekend never sees your password."}
          </Text>
        </View>
        {cookies && teams.length > 0 && (
          <View style={styles.teams}>
            {teams.map((t) => (
              <Pressable
                key={t.leagueId}
                onPress={() => finish({ espnS2: cookies.s2, swid: cookies.swid, leagueId: t.leagueId })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.team, pressed && styles.dim]}>
                <Text style={styles.teamName} numberOfLines={1}>
                  {t.name}
                </Text>
                <Text style={styles.teamGo}>Use this league ›</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={styles.addressRow}>
          <Text style={styles.address} numberOfLines={1} ellipsizeMode="middle" selectable>
            {address}
          </Text>
          <Pressable onPress={startOver} hitSlop={8} accessibilityRole="button">
            <Text style={styles.startOver}>Start over</Text>
          </Pressable>
        </View>
        <View style={styles.flex}>
          {visible && (
            <WebView
              ref={web}
              key={attempt}
              source={{ uri: LOGIN_URL }}
              // Present as mobile Safari: ESPN's sign-in can send an
              // in-app browser down a different path than Safari.
              applicationNameForUserAgent="Version/18.0 Safari/604.1"
              onNavigationStateChange={(nav) => {
                try {
                  const u = new URL(nav.url);
                  setAddress(u.host + u.pathname);
                } catch {
                  setAddress(nav.url);
                }
              }}
              onHttpError={(e) => {
                const code = e.nativeEvent.statusCode;
                if (code === 404 && signedIn.current) return toHub();
                onMissingPage.current = code === 404;
                if (code >= 400) setFailed(code);
              }}
              injectedJavaScript={WATCH}
              onLoadEnd={() => setLoading(false)}
              onMessage={(e) => {
                let msg: { s2?: string | null; swid?: string | null; url?: string; teams?: { leagueId: string; name: string }[] };
                try {
                  msg = JSON.parse(e.nativeEvent.data);
                } catch {
                  return;
                }
                if (!msg.s2 || !msg.swid) return;
                const found = { s2: decodeURIComponent(msg.s2), swid: decodeURIComponent(msg.swid) };
                session.current = session.current ?? found;
                setCookies((prev) => prev ?? found);
                if (msg.teams?.length) setTeams(msg.teams);
                if (!signedIn.current) {
                  signedIn.current = true;
                  if (onMissingPage.current) toHub();
                }
                const leagueId = msg.url ? leagueIdFrom(msg.url) : null;
                if (leagueId) finish({ espnS2: found.s2, swid: found.swid, leagueId });
              }}
              // The page itself stays on ESPN and Disney's sign-in; frames
              // inside it (the login form, its captcha) load as they need.
              onShouldStartLoadWithRequest={(req) => {
                // Tapping a team on ESPN opens the ESPN app when it's
                // installed (a test sign-in did, 2026-10-27), so the league
                // is caught here, before the link goes anywhere.
                const leagueId = leagueIdFrom(req.url);
                if (leagueId && session.current) {
                  finish({ espnS2: session.current.s2, swid: session.current.swid, leagueId });
                  return false;
                }
                return (
                  req.url === 'about:blank' ||
                  (req.isTopFrame === false ? /^https:/i.test(req.url) : ESPN_PAGE.test(req.url))
                );
              }}
              setSupportMultipleWindows={false}
              sharedCookiesEnabled={false}
              incognito
              style={styles.flex}
            />
          )}
          {loading && (
            <View style={styles.loading} pointerEvents="none">
              <ActivityIndicator color={Colors.accent} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.bg },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, minHeight: 52 },
  barButton: { minWidth: 60, minHeight: 44, justifyContent: 'center' },
  barTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  barText: { color: Colors.text, fontSize: 15 },
  barDone: { color: Colors.accent, fontWeight: '700', textAlign: 'right' },
  dim: { opacity: 0.35 },
  banner: { marginHorizontal: Spacing.lg, marginBottom: Spacing.sm, padding: 10, borderRadius: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  teams: { marginHorizontal: Spacing.lg, marginBottom: Spacing.sm, gap: 6 },
  team: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.accent, backgroundColor: Colors.surface },
  teamName: { flex: 1, color: Colors.text, fontSize: 15, fontWeight: '700' },
  teamGo: { color: Colors.accent, fontSize: 13, fontWeight: '700' },
  bannerError: { borderColor: '#f87171' },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  address: { flex: 1, color: Colors.textSecondary, fontSize: 11 },
  startOver: { color: Colors.accent, fontSize: 13, fontWeight: '600' },
  bannerOn: { borderColor: Colors.accent, backgroundColor: 'rgba(57,255,20,0.08)' },
  bannerText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  bannerTextOn: { color: Colors.text, fontWeight: '600' },
  flex: { flex: 1 },
  loading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
