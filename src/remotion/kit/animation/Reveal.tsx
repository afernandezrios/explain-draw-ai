/**
 * A beat, applied to whatever is inside it.
 *
 * Scenes that draw in a diagram compute their own geometry and call
 * `revealStyle` directly; this is for everything else -- a card, a pill, a row
 * of text -- where wrapping is clearer than threading a style through.
 *
 * The wrapper owns `opacity`, `translate` and `scale`: a caller's `style` is
 * applied first and the animation after it, so the animation always wins. It
 * also means a `Reveal` is a block-level box; for a row of things that should
 * sit on one line, wrap the row, not each item.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { MOTION } from '../tokens.ts';
import { revealStyle, type RevealPreset } from './presets.ts';
import { toFrames } from './timing.ts';

export type RevealProps = {
  children: React.ReactNode;
  preset?: RevealPreset;
  /** Frames from the scene's start, from `paceReveals`. */
  delay?: number;
  /** Frames the entrance takes. Defaults to `MOTION.enterSeconds`. */
  duration?: number;
  distance?: number;
  style?: CSSProperties;
};

export const Reveal: React.FC<RevealProps> = ({
  children,
  preset = 'rise',
  delay = 0,
  duration,
  distance,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const span = duration ?? toFrames(MOTION.enterSeconds, fps);

  return (
    <div style={{ ...style, ...revealStyle(preset, frame, { delay, duration: span }, distance) }}>
      {children}
    </div>
  );
};
