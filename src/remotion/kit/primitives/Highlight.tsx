/**
 * The marker over the words that matter.
 *
 * Not a colour change -- a *drawn* swash, so it has an arrival: it sweeps
 * across the phrase from the left while the narration says it, which is the one
 * gesture that ties a spoken word to a written one. `underline` is the same
 * idea with a thinner pen, for a phrase that should be pointed at rather than
 * painted over.
 *
 * It is drawn in the kit's own language rather than with a rough/hand-drawn
 * annotation library: this design system is flat and precise (see `Edge`), and
 * a dependency that draws differently would be a second visual voice. The cost
 * is that the swash is a clean band, not a felt-tip smear.
 *
 * The swash is an absolutely positioned child of the text itself, so its `em`
 * offsets resolve against the font's content box -- not the line box -- and the
 * same band sits the same way in a 21px label and a 44px heading. The offsets
 * are tuned to Inter's metrics (cap height ~0.73em, baseline ~0.97em below the
 * content-box top); a wrapped phrase has no single box to be measured against,
 * so keep the markup to a run that stays on one line.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { alpha, type Accent } from '../tokens.ts';
import { useTheme } from '../theme.tsx';
import { useEnterProgress } from '../animation/useEnter.ts';
import type { Timing } from '../animation/timing.ts';

export type HighlightVariant = 'marker' | 'underline';

export type HighlightProps = {
  /** The run to mark up. Inline content only, and short enough to stay on the
   * line it starts on. */
  children: React.ReactNode;
  variant?: HighlightVariant;
  accent?: Accent;
  /** Overrides `accent`, for a pen that has no meaning to attach a name to. */
  color?: string;
  /** How much of the swash is drawn, 0 to 1. Overrides `enter`. */
  progress?: number;
  /** When the swash sweeps in, in frames from the composition's start. Omit to
   * draw it fully. */
  enter?: Timing;
  style?: CSSProperties;
};

export const Highlight: React.FC<HighlightProps> = ({
  children,
  variant = 'marker',
  accent = 'amber',
  color,
  progress,
  enter,
  style,
}) => {
  const theme = useTheme();
  const draw = useEnterProgress(progress, enter);
  const ink = color ?? theme.accent[accent];
  const marker = variant === 'marker';

  return (
    <span style={{ position: 'relative', ...style }}>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          // A band from just under the caps to just under the baseline; the
          // underline sits on the baseline instead.
          top: marker ? '0.18em' : '0.99em',
          height: marker ? '0.90em' : '0.09em',
          left: marker ? '-0.14em' : '-0.08em',
          right: marker ? '-0.14em' : '-0.08em',
          borderRadius: marker ? '0.12em' : '0.05em',
          backgroundColor: marker ? alpha(ink, 34) : alpha(ink, 90),
          transformOrigin: 'left center',
          scale: `${draw} 1`,
        }}
      />
      {/* Positioned as well, so it paints after the swash rather than under
          it: two positioned siblings are painted in DOM order. */}
      <span style={{ position: 'relative' }}>{children}</span>
    </span>
  );
};
