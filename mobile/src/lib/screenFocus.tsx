import { useIsFocused } from 'expo-router';
import { createContext, useContext, type ReactNode } from 'react';

// Is the screen this component sits on the one you're looking at?
// Native tabs keep every visited tab mounted, and a pushed screen keeps
// the ones under it mounted, so anything that animates every frame or
// polls on a timer keeps running out of sight unless it asks. Tabs
// (components/TabFrame.tsx) and every other screen (app/_layout.tsx's
// withTickerBar) provide this; anything drawn outside a screen (the
// launch picker, the intro) is always on top, so the default is true.
const ScreenFocusContext = createContext(true);

export function ScreenFocusProvider({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  return <ScreenFocusContext.Provider value={focused}>{children}</ScreenFocusContext.Provider>;
}

// Tabs already know their own focus; this hands it down without asking twice.
export function ScreenFocusValue({ focused, children }: { focused: boolean; children: ReactNode }) {
  return <ScreenFocusContext.Provider value={focused}>{children}</ScreenFocusContext.Provider>;
}

export function useScreenFocused(): boolean {
  return useContext(ScreenFocusContext);
}
