import { Link, type Href } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';

// An SF Symbol name, as Link.MenuAction takes it.
type SFSymbol = NonNullable<ComponentProps<typeof Link.MenuAction>['icon']>;

export type PreviewMenuItem = {
  title: string;
  icon?: SFSymbol;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

// iOS's long-press preview, like Mail or Photos: press and hold a row to
// see a live preview of the screen it opens, plus `menu` actions under
// it. Tapping the row (or the preview) opens it as usual. On Android
// it's just the link.
//
// This draws the row's pressable itself, from plain style objects: the
// link hands its props to that pressable by merging style objects, and a
// row's usual `style={({ pressed }) => ...}` function can't be merged —
// it came through empty, so the row lost its whole layout.
export function PreviewLink({
  href,
  menu,
  style,
  pressedStyle,
  disabled,
  children,
}: {
  href: Href;
  menu?: PreviewMenuItem[];
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Link href={href} asChild disabled={disabled}>
      <Link.Trigger>
        <Pressable
          disabled={disabled}
          accessibilityRole="link"
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          style={StyleSheet.flatten([style, pressed && pressedStyle])}>
          {children}
        </Pressable>
      </Link.Trigger>
      {/* Screens are see-through (the app's honeycomb sits behind the
          navigator), so a floating preview needs its own background. */}
      <Link.Preview style={styles.preview} />
      {menu && menu.length > 0 ? (
        <Link.Menu>
          {menu.map((m) => (
            <Link.MenuAction
              key={m.title}
              title={m.title}
              icon={m.icon}
              onPress={m.onPress}
              destructive={m.destructive}
              disabled={m.disabled}
            />
          ))}
        </Link.Menu>
      ) : null}
    </Link>
  );
}

const styles = StyleSheet.create({
  preview: { backgroundColor: Colors.bg },
});
