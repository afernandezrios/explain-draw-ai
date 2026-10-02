/**
 * Which theme the components below are drawn in.
 *
 * The theme travels by context rather than by prop so that a nested primitive
 * four levels down a diagram -- a code line's punctuation, a node's sublabel --
 * does not have to be handed the palette at every level. `Frame` provides it
 * for a scene; `KitTheme` provides it for anything rendered on its own.
 *
 * The default is the dark theme rather than an error, so a component rendered
 * without a provider still draws something deliberate.
 */

import React, { createContext, useContext } from 'react';
import { DARK, THEMES, type Theme, type ThemeName } from './tokens.ts';

/** A scene may name a theme or hand in a whole one. */
export type ThemeProp = ThemeName | Theme;

export function resolveTheme(theme?: ThemeProp): Theme {
  if (theme === undefined) {
    return DARK;
  }
  return typeof theme === 'string' ? THEMES[theme] : theme;
}

const ThemeContext = createContext<Theme>(DARK);

export const KitTheme: React.FC<{ theme?: ThemeProp; children: React.ReactNode }> = ({
  theme,
  children,
}) => <ThemeContext.Provider value={resolveTheme(theme)}>{children}</ThemeContext.Provider>;

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
