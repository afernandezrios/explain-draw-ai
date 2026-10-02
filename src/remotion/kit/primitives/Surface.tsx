/**
 * The box everything else is drawn in: a node, a code panel, a callout, a card.
 *
 * One component rather than four, because the difference between them is tone,
 * padding and whether it sits on the canvas or above it -- all of which are
 * props. A tone tints the fill and the border together; passing an `accent`
 * directly is the escape hatch for a one-off colour that has no meaning to
 * attach a tone to.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { RADIUS, alpha, mix, toneAccent, type Accent, type Tone } from '../tokens.ts';
import { useTheme } from '../theme.tsx';

export type SurfaceProps = {
  children?: React.ReactNode;
  tone?: Tone;
  accent?: Accent;
  pad?: number;
  radius?: keyof typeof RADIUS;
  /** Lifts the box with a shadow. For panels that float over the canvas. */
  raised?: boolean;
  /** Draws the border. Off for a plain tinted area. */
  outlined?: boolean;
  style?: CSSProperties;
};

export const Surface: React.FC<SurfaceProps> = ({
  children,
  tone = 'neutral',
  accent,
  pad = 24,
  radius = 'lg',
  raised = false,
  outlined = true,
  style,
}) => {
  const theme = useTheme();
  const resolved = accent ?? toneAccent(tone);

  return (
    <div
      style={{
        // A node's DOM box has to be exactly the rect its edges are drawn to,
        // and browsers default to content-box.
        boxSizing: 'border-box',
        backgroundColor:
          resolved === null ? (raised ? theme.surfaceRaised : theme.surface) : mix(theme.accent[resolved], 8, theme.surface),
        border: outlined
          ? `1px solid ${resolved === null ? theme.border : alpha(theme.accent[resolved], 38)}`
          : undefined,
        borderRadius: RADIUS[radius],
        padding: pad,
        boxShadow: raised ? theme.shadow : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
