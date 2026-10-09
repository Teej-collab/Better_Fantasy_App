import type { StyleProp, TextStyle } from 'react-native';

import { Text } from '@/components/Text';
import { isHexColor, isMulti, MULTI_COLORS } from '@/lib/colorChoice';

// A chat sender's name in their Chat Bubble Color — or, for Multi, each
// letter in the next of Multi's colors.
export function ChatNameText({ name, chatColor, fallback, style }: { name: string; chatColor: string | null | undefined; fallback?: string; style?: StyleProp<TextStyle> }) {
  if (isMulti(chatColor)) {
    let i = 0;
    return (
      <Text style={style}>
        {Array.from(name).map((ch, k) => (
          <Text key={k} style={/\s/.test(ch) ? undefined : { color: MULTI_COLORS[i++ % MULTI_COLORS.length] }}>
            {ch}
          </Text>
        ))}
      </Text>
    );
  }
  const color = isHexColor(chatColor) ? chatColor : fallback;
  return <Text style={[style, color ? { color } : null]}>{name}</Text>;
}
