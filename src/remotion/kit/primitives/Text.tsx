/**
 * Text, in the scale rather than in a size.
 *
 * The point of routing every string through one component is that a scene
 * cannot invent a 31px font: it picks a rung of `TYPE`, and `clamp` is the one
 * concession to generated copy -- a spec that runs long is ellipsised rather
 * than allowed to push a diagram off the canvas.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { FONT, TYPE, alpha, type Accent, type TextVariant } from '../tokens.ts';
import { useTheme } from '../theme.tsx';

export type TextTone = 'text' | 'secondary' | 'muted';

export type TextProps = {
  children: React.ReactNode;
  variant?: TextVariant;
  tone?: TextTone;
  /** Overrides `tone` when set: the string is drawn in the accent. */
  accent?: Accent;
  mono?: boolean;
  align?: CSSProperties['textAlign'];
  /** Lines to show before ellipsising. Omit to let the text run. */
  clamp?: number;
  style?: CSSProperties;
};

export const Text: React.FC<TextProps> = ({
  children,
  variant = 'body',
  tone = 'text',
  accent,
  mono = false,
  align,
  clamp,
  style,
}) => {
  const theme = useTheme();
  const color =
    accent !== undefined
      ? theme.accent[accent]
      : tone === 'secondary'
        ? theme.textSecondary
        : tone === 'muted'
          ? theme.textMuted
          : theme.text;

  return (
    <div
      style={{
        ...TYPE[variant],
        color,
        fontFamily: mono ? FONT.mono : FONT.sans,
        textAlign: align,
        ...(clamp === undefined
          ? {}
          : {
              display: '-webkit-box',
              WebkitLineClamp: clamp,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }),
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/**
 * A rule that grows out of nothing, for the small accent bar an eyebrow sits
 * beside. Width is given in pixels because it is a piece of geometry, not a
 * piece of copy.
 */
export const AccentRule: React.FC<{
  progress: number;
  width: number;
  accent?: Accent;
  thickness?: number;
  style?: CSSProperties;
}> = ({ progress, width, accent = 'blue', thickness = 4, style }) => {
  const theme = useTheme();
  return (
    <div
      style={{
        width,
        height: thickness,
        borderRadius: thickness / 2,
        backgroundColor: alpha(theme.accent[accent], 90),
        scale: `${progress} 1`,
        transformOrigin: 'left center',
        ...style,
      }}
    />
  );
};
