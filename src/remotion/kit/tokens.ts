/**
 * The kit's design tokens.
 *
 * Everything visual resolves through this file: a component asks the theme for a
 * colour and these scales for a size, so the six scene types stay one visual
 * language instead of six dialects of one. A theme is data, not a component --
 * swapping `DARK` for `LIGHT` re-skins every scene without a scene knowing.
 *
 * Sizes are canvas pixels, not rem or percentages. A composition is rendered at
 * exactly CANVAS_WIDTH x CANVAS_HEIGHT, so a 27px body is 27px in the file:
 * there is no viewer to resize it and nothing to be relative to.
 *
 * This module is deliberately data-only -- strings and numbers, no components
 * and no font loading. `fonts.ts` is what turns FONT.sans into a loaded face,
 * and the split matters: importing this file must stay free of side effects so
 * a scene can be measured, previewed or reasoned about without a network.
 */

import type { CSSProperties } from 'react';
import { CANVAS_HEIGHT, CANVAS_WIDTH, FPS } from '../../lib/render-config.ts';

/** The render canvas, re-exported so a kit composition never restates it. */
export const CANVAS = {
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  fps: FPS,
} as const;

/**
 * The accent vocabulary. Six names, not six colours: a scene says `accent:
 * 'blue'`, the theme decides what blue is. `alpha()` turns any of them into the
 * tints and washes the components need.
 */
export const ACCENTS = ['blue', 'cyan', 'violet', 'green', 'amber', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];

/**
 * A tone is a meaning -- success, danger -- and maps onto an accent so the
 * meaning survives a re-skin. `neutral` is the absence of one: components fall
 * back to the plain surface and border colours.
 */
export const TONES = {
  neutral: null,
  info: 'blue',
  accent: 'violet',
  success: 'green',
  warn: 'amber',
  danger: 'rose',
} as const satisfies Record<string, Accent | null>;
export type Tone = keyof typeof TONES;

export type ThemeName = 'dark' | 'light';

export type Theme = {
  name: ThemeName;
  /** The canvas behind everything. */
  bg: string;
  /** A card, a node, a code panel. */
  surface: string;
  /** A surface that should lift off its neighbours. */
  surfaceRaised: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  /** Grid lines, already translucent. */
  grid: string;
  accent: Record<Accent, string>;
  /** Text and icons drawn *on* a filled accent. */
  onAccent: string;
  shadow: string;
  /** The syntax palette. Separate from `accent` because code reads by hue
   * contrast between neighbouring tokens, not by meaning. */
  code: {
    plain: string;
    keyword: string;
    string: string;
    number: string;
    comment: string;
    fn: string;
    property: string;
    punct: string;
    lineNumber: string;
  };
};

export const DARK: Theme = {
  name: 'dark',
  bg: '#0a0e16',
  surface: '#111827',
  surfaceRaised: '#161f30',
  border: 'rgba(255, 255, 255, 0.075)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',
  text: '#e8edf7',
  textSecondary: '#9cacc8',
  textMuted: '#63718f',
  grid: 'rgba(255, 255, 255, 0.045)',
  accent: {
    blue: '#4d8dff',
    cyan: '#3fc9e0',
    violet: '#a78bfa',
    green: '#3fd68c',
    amber: '#f5b04c',
    rose: '#ff6b81',
  },
  onAccent: '#08111f',
  shadow: '0 24px 60px rgba(0, 0, 0, 0.45)',
  code: {
    plain: '#dce4f2',
    keyword: '#c792ea',
    string: '#7fd88f',
    number: '#f5b04c',
    comment: '#5c6b8a',
    fn: '#6ba6ff',
    property: '#5fd3e8',
    punct: '#8593b0',
    lineNumber: '#4a5875',
  },
};

export const LIGHT: Theme = {
  name: 'light',
  bg: '#f5f7fb',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  border: '#dfe5f0',
  borderStrong: '#c3cde0',
  text: '#0d1524',
  textSecondary: '#4b5a78',
  textMuted: '#7c89a6',
  grid: 'rgba(13, 21, 36, 0.055)',
  accent: {
    blue: '#2563eb',
    cyan: '#0e9bb5',
    violet: '#7c3aed',
    green: '#0e9f6e',
    amber: '#d97706',
    rose: '#e11d48',
  },
  onAccent: '#ffffff',
  shadow: '0 20px 45px rgba(15, 23, 42, 0.10)',
  code: {
    plain: '#1e293b',
    keyword: '#7c3aed',
    string: '#0e9f6e',
    number: '#b45309',
    comment: '#94a3b8',
    fn: '#2563eb',
    property: '#0e7490',
    punct: '#64748b',
    lineNumber: '#a3aec2',
  },
};

export const THEMES: Record<ThemeName, Theme> = { dark: DARK, light: LIGHT };

/**
 * A translucent version of any colour. `color-mix` rather than a hex parser:
 * it keeps the theme a list of literals -- including the `rgba()` borders --
 * and it is why an accent can produce a 14% chip fill without a second table of
 * hand-tuned tints. Chrome-only, which is what renders these compositions.
 */
export function alpha(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** An accent folded into a surface -- the tint a tinted card sits on. */
export function mix(color: string, percent: number, base: string): string {
  return `color-mix(in srgb, ${color} ${percent}%, ${base})`;
}

/** The accent a tone resolves to, or null for `neutral`. */
export function toneAccent(tone: Tone): Accent | null {
  return TONES[tone];
}

/**
 * The two faces the kit draws with. Strings only -- `fonts.ts` loads them --
 * and each includes its fallbacks so a scene rendered without the loader (a
 * unit of markup, a future web preview) still lays out in something sane.
 */
export const FONT = {
  sans: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

/**
 * The type scale. Video is watched, not read: these run a size or two larger
 * than the same names would on a web page, and nothing here is smaller than
 * 21px at 1080p, which is the floor where a label survives compression.
 */
export const TYPE = {
  display: {
    fontSize: 108,
    lineHeight: 1.05,
    fontWeight: 700,
    letterSpacing: '-0.028em',
  },
  title: {
    fontSize: 62,
    lineHeight: 1.12,
    fontWeight: 600,
    letterSpacing: '-0.02em',
  },
  heading: {
    fontSize: 44,
    lineHeight: 1.2,
    fontWeight: 600,
    letterSpacing: '-0.015em',
  },
  subheading: {
    fontSize: 32,
    lineHeight: 1.35,
    fontWeight: 500,
    letterSpacing: '-0.01em',
  },
  body: {
    fontSize: 27,
    lineHeight: 1.55,
    fontWeight: 400,
  },
  small: {
    fontSize: 23,
    lineHeight: 1.5,
    fontWeight: 400,
  },
  label: {
    fontSize: 21,
    lineHeight: 1,
    fontWeight: 600,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
  },
  mono: {
    fontSize: 25,
    lineHeight: 1.5,
    fontWeight: 400,
  },
  code: {
    fontSize: 26,
    lineHeight: 1.62,
    fontWeight: 400,
  },
} satisfies Record<string, CSSProperties>;
export type TextVariant = keyof typeof TYPE;

export const SPACE = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const RADIUS = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
  pill: 999,
} as const;

/**
 * The scene shell's geometry. Fixed rather than content-driven, because the
 * content box is handed to scenes as a number they lay diagrams out against --
 * a header that grew with its title would move every node in the diagram.
 * Titles are therefore one line by contract; long copy belongs in the body.
 */
export const LAYOUT = {
  padX: 96,
  padTop: 76,
  padBottom: 76,
  headerHeight: 128,
  headerGap: 44,
  footerHeight: 56,
  footerGap: 28,
  gridStep: 64,
} as const;

/** The content box a scene gets inside `Frame`, in canvas pixels. */
export function frameContentBox(hasHeader: boolean, hasFooter: boolean): { width: number; height: number } {
  return {
    width: CANVAS_WIDTH - LAYOUT.padX * 2,
    height:
      CANVAS_HEIGHT -
      LAYOUT.padTop -
      LAYOUT.padBottom -
      (hasHeader ? LAYOUT.headerHeight + LAYOUT.headerGap : 0) -
      (hasFooter ? LAYOUT.footerHeight + LAYOUT.footerGap : 0),
  };
}

/**
 * Motion. Seconds, not frames: the same storyboard should breathe the same at
 * 24fps and 30, and a scene that paced itself in frames would quietly speed up
 * when the project's FPS changed.
 *
 * `leadSeconds` and `tailSeconds` are the dead air a scene keeps before its
 * first beat and after its last, so narration has somewhere to sit and the
 * scene does not end on a hard cut.
 */
export const MOTION = {
  leadSeconds: 0.3,
  tailSeconds: 0.55,
  enterSeconds: 0.6,
  staggerSeconds: 0.16,
  /** How far a slide or a rise travels, in pixels. Big, but not a journey. */
  distance: 26,
} as const;
