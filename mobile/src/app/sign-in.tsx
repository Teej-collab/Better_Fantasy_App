import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiveTicker } from '@/components/home/LiveTicker';
import { IntroOverlay } from '@/components/IntroOverlay';
import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { api, WEB_BASE_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setPendingLeagueIntent } from '@/lib/onboarding';
import { useNflScoreboard } from '@/lib/queries';
import { buildNflTickerItems } from '@/lib/ticker';

type Variant = 'signin' | 'join' | 'create';
type Step = 'intro' | 'choice' | 'auth' | 'forgot';

// The signed-out front door, ported from the web's OpeningExperience →
// EntryChoiceStage → SignInCard: the intro and Enter Here, then Get
// Started (Sign In / Join a League / Create a League), then Discord or
// email. Join/Create skip Discord (it only links League #1's existing
// members) and go straight to creating an account; the no-league
// screen then opens Leagues at that step.
export default function SignInScreen() {
  const [step, setStep] = useState<Step>('intro');
  const [variant, setVariant] = useState<Variant>('signin');
  const games = useNflScoreboard().data ?? [];

  if (step === 'intro') {
    return (
      <IntroOverlay
        mode="enter"
        onDone={() => setStep('choice')}
        footer={<LiveTicker items={buildNflTickerItems(games)} fast={games.some((g) => g.state === 'in')} interactive={false} />}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
          {step === 'choice' && (
            <ChoiceStage
              onChoose={(v) => {
                setVariant(v);
                setStep('auth');
              }}
              onBack={() => setStep('intro')}
            />
          )}
          {step === 'auth' && <SignInCard variant={variant} onBack={() => setStep('choice')} onForgot={() => setStep('forgot')} />}
          {step === 'forgot' && <ForgotPassword onBack={() => setStep('auth')} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Kicker({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.kickerBlock}>
      <Text style={styles.kicker}>The Weekend</Text>
      <Text style={styles.heading}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

function NeonButton({ label, onPress, big }: { label: string; onPress: () => void; big?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.neon, big && styles.neonBig, pressed && styles.pressed]}>
      <Text style={[styles.neonText, big && styles.neonTextBig]}>{label}</Text>
    </Pressable>
  );
}

// The web's EntryChoiceStage.
function ChoiceStage({ onChoose, onBack }: { onChoose: (v: Variant) => void; onBack: () => void }) {
  return (
    <View style={styles.stage}>
      <Kicker title="Get Started" />
      <Text style={styles.tagline}>Already play? Sign in. New here? Join a league you&apos;re already in, or start one of your own.</Text>
      <View style={styles.choices}>
        <NeonButton label="SIGN IN" big onPress={() => onChoose('signin')} />
        <NeonButton label="JOIN A LEAGUE" onPress={() => onChoose('join')} />
        <NeonButton label="CREATE A LEAGUE" onPress={() => onChoose('create')} />
      </View>
      <Pressable onPress={onBack} hitSlop={10}>
        <Text style={styles.link}>← Back</Text>
      </Pressable>
    </View>
  );
}

// The web's SignInCard: Discord, or email (sign in / create account).
function SignInCard({ variant, onBack, onForgot }: { variant: Variant; onBack: () => void; onForgot: () => void }) {
  const { signInWithApple, signInWithDiscord, signInWithGoogle, signInWithToken } = useAuth();
  const [googleOn, setGoogleOn] = useState(false);
  const [appleOn, setAppleOn] = useState(false);
  useEffect(() => {
    api.signInProviders().then((p) => setGoogleOn(p.google)).catch(() => {});
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleOn).catch(() => {});
  }, []);
  const intent = variant !== 'signin';
  const [showEmail, setShowEmail] = useState(intent);
  const [mode, setMode] = useState<'signin' | 'signup'>(intent ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onProvider(signIn: () => Promise<{ ok: boolean; canceled?: boolean; message?: string }>) {
    setBusy(true);
    setError(null);
    if (intent) setPendingLeagueIntent(variant as 'join' | 'create');
    const result = await signIn();
    // On success the root layout's guard swaps to the app; nothing to do.
    if (!result.ok && !result.canceled) {
      haptics.error();
      setError(result.message ?? 'Something went wrong signing you in.');
    }
    setBusy(false);
  }

  async function onSubmit() {
    setError(null);
    if (mode === 'signup' && password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const { token } = mode === 'signup' ? await api.signup(email.trim(), password, displayName.trim()) : await api.login(email.trim(), password);
      if (intent) setPendingLeagueIntent(variant as 'join' | 'create');
      await signInWithToken(token);
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  const canSubmit = !busy && !!email.trim() && !!password && (mode === 'signin' || (!!displayName.trim() && !!confirm));

  return (
    <View style={styles.card}>
      <Kicker
        title={variant === 'join' ? 'Join a League' : variant === 'create' ? 'Create a League' : 'Welcome back'}
        subtitle={
          variant === 'join'
            ? 'Create your account, then join with the invite code your commissioner shares.'
            : variant === 'create'
              ? 'Create your account, then start your own league in a few taps.'
              : undefined
        }
      />

      {!showEmail ? (
        <>
          {/* Apple first (App Review wants it at least as prominent as
              the others), then Google and email; Discord — the original
              League #1 sign-in — stays as a quieter option. */}
          {appleOn && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={variant === 'signin' ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={Radius.pill}
              style={styles.apple}
              onPress={() => !busy && onProvider(signInWithApple)}
            />
          )}
          {googleOn && (
            <Pressable onPress={() => onProvider(signInWithGoogle)} disabled={busy} style={({ pressed }) => [styles.google, (pressed || busy) && styles.pressed]}>
              <Text style={styles.googleText}>Continue with Google</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setShowEmail(true)} style={({ pressed }) => [styles.outline, pressed && styles.pressed]}>
            <Text style={styles.outlineText}>Continue with email</Text>
          </Pressable>
          {busy && <ActivityIndicator color={Colors.textSecondary} />}
          <Pressable onPress={() => onProvider(signInWithDiscord)} disabled={busy} hitSlop={8}>
            <Text style={[styles.link, styles.centerText]}>Continue with Discord</Text>
          </Pressable>
        </>
      ) : (
        <View style={styles.form}>
          {!intent && (
            <View style={styles.toggle}>
              {(['signin', 'signup'] as const).map((m) => (
                <Pressable key={m} onPress={() => setMode(m)} style={[styles.toggleItem, mode === m && styles.toggleActive]}>
                  <Text style={[styles.toggleText, mode === m && styles.toggleTextActive]}>{m === 'signin' ? 'Sign in' : 'Create account'}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {mode === 'signup' && (
            <Field value={displayName} onChange={setDisplayName} placeholder="Display name" autoComplete="name" textContentType="name" />
          )}
          <Field
            value={email}
            onChange={setEmail}
            placeholder="Email"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
          <Field
            value={password}
            onChange={setPassword}
            placeholder="Password"
            secure
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            textContentType={mode === 'signup' ? 'newPassword' : 'password'}
          />
          {mode === 'signin' && (
            <Pressable onPress={onForgot} hitSlop={8} style={styles.forgot}>
              <Text style={styles.link}>Forgot password?</Text>
            </Pressable>
          )}
          {mode === 'signup' && (
            <Field value={confirm} onChange={setConfirm} placeholder="Confirm password" secure autoComplete="new-password" textContentType="newPassword" />
          )}
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable onPress={onSubmit} disabled={!canSubmit} style={({ pressed }) => [styles.primary, (!canSubmit || pressed) && styles.pressed]}>
            {busy ? <ActivityIndicator color="#06110a" /> : <Text style={styles.primaryText}>{mode === 'signup' ? 'Create account' : 'Sign in'}</Text>}
          </Pressable>
          {!intent && (
            <Pressable onPress={() => setShowEmail(false)} hitSlop={8}>
              <Text style={[styles.link, styles.centerText]}>← Other ways to sign in</Text>
            </Pressable>
          )}
        </View>
      )}

      {!showEmail && error && <Text style={styles.error}>{error}</Text>}

      {(!showEmail || intent) && (
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={[styles.link, styles.centerText]}>← Back</Text>
        </Pressable>
      )}

      <Text style={styles.legal}>
        By continuing, you agree to our{' '}
        <Text style={styles.legalLink} onPress={() => void WebBrowser.openBrowserAsync(`${WEB_BASE_URL}/terms`)}>
          Terms
        </Text>{' '}
        and{' '}
        <Text style={styles.legalLink} onPress={() => void WebBrowser.openBrowserAsync(`${WEB_BASE_URL}/privacy`)}>
          Privacy Policy
        </Text>
        .
      </Text>
    </View>
  );
}

// The web's ForgotPasswordForm. The emailed link resets the password on
// the website; then sign in here with the new one.
function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      setMessage((await api.forgotPassword(email.trim())).message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Kicker title="Reset password" />
      {message ? (
        <Text style={[styles.tagline, styles.centerText]}>{message}</Text>
      ) : (
        <View style={styles.form}>
          <Text style={[styles.tagline, styles.centerText]}>Enter the email on your account and we&apos;ll send a link to reset your password.</Text>
          <Field value={email} onChange={setEmail} placeholder="Email" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable onPress={onSubmit} disabled={busy || !email.trim()} style={({ pressed }) => [styles.primary, (busy || !email.trim() || pressed) && styles.pressed]}>
            {busy ? <ActivityIndicator color="#06110a" /> : <Text style={styles.primaryText}>Send reset link</Text>}
          </Pressable>
        </View>
      )}
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={[styles.link, styles.centerText]}>← Back to sign in</Text>
      </Pressable>
    </View>
  );
}

function Field(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secure?: boolean;
  keyboardType?: 'email-address' | 'default';
  autoComplete?: 'email' | 'name' | 'new-password' | 'current-password';
  textContentType?: 'emailAddress' | 'name' | 'newPassword' | 'password';
}) {
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChange}
      placeholder={props.placeholder}
      placeholderTextColor={Colors.textSecondary}
      secureTextEntry={props.secure}
      keyboardType={props.keyboardType ?? 'default'}
      autoComplete={props.autoComplete}
      textContentType={props.textContentType}
      autoCapitalize={props.autoComplete === 'name' ? 'words' : 'none'}
      autoCorrect={false}
      style={styles.input}
    />
  );
}

const ACCENT = Colors.accent;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  center: { flexGrow: 1, justifyContent: 'center', padding: Spacing.xl },
  centerText: { textAlign: 'center' },
  pressed: { opacity: 0.6 },
  stage: { alignItems: 'center', gap: Spacing.xl },
  kickerBlock: { alignItems: 'center', gap: 4 },
  kicker: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', letterSpacing: 3, textTransform: 'uppercase' },
  heading: { fontFamily: Fonts.display, color: Colors.text, fontSize: 26, letterSpacing: 1, textTransform: 'uppercase' },
  subtitle: { maxWidth: 260, color: Colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 4 },
  tagline: { maxWidth: 290, color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  choices: { alignSelf: 'stretch', alignItems: 'center', gap: Spacing.md },
  neon: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: ACCENT,
    backgroundColor: 'rgba(6,10,7,0.85)',
    paddingVertical: 12,
    shadowColor: ACCENT,
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  neonBig: { paddingVertical: 15 },
  neonText: { color: ACCENT, fontSize: 13, fontWeight: '700', letterSpacing: 2, textShadowColor: ACCENT, textShadowRadius: 8 },
  neonTextBig: { fontSize: 15 },
  link: { color: Colors.textSecondary, fontSize: 13 },
  card: {
    gap: Spacing.xl,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: Spacing.xl + 4,
  },
  apple: { height: 50, marginBottom: -Spacing.sm },
  google: { backgroundColor: '#ffffff', borderRadius: Radius.pill, paddingVertical: 15, alignItems: 'center', marginBottom: -Spacing.sm },
  googleText: { color: '#1f1f1f', fontSize: 15, fontWeight: '600' },
  outline: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingVertical: 13, alignItems: 'center' },
  outlineText: { color: Colors.text, fontSize: 15, fontWeight: '500' },
  form: { gap: Spacing.md },
  toggle: { flexDirection: 'row', gap: 4, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, padding: 4 },
  toggleItem: { flex: 1, alignItems: 'center', borderRadius: Radius.pill, paddingVertical: 7 },
  toggleActive: { backgroundColor: ACCENT },
  toggleText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' },
  toggleTextActive: { color: '#06110a' },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
    color: Colors.text,
    fontSize: 16,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  forgot: { alignSelf: 'flex-end', marginTop: -4 },
  error: { color: Colors.loss, fontSize: 13, textAlign: 'center' },
  primary: { backgroundColor: ACCENT, borderRadius: Radius.pill, paddingVertical: 15, alignItems: 'center' },
  primaryText: { color: '#06110a', fontSize: 15, fontWeight: '600' },
  legal: { color: Colors.textSecondary, fontSize: 11, textAlign: 'center' },
  legalLink: { textDecorationLine: 'underline' },
});
