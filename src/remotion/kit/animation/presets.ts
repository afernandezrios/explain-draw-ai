/**
 * How an element arrives.
 *
 * Six presets, and that is the whole vocabulary on purpose: a library where
 * every scene invents its own entrance is a library that looks like six people
 * made it. A scene picks a preset and a beat from `paceReveals`, and the motion
 * language stays consistent across all of them.
 *
 * The styles are written with the `translate` / `scale` CSS properties rather
 * than `transform` strings, which is what lets the Studio read and keyframe
 * them, and they are produced here rather than inline at each call site because
 * these are the reusable parts -- the call site passes data, not animation.
 */

import { Easing, interpolate } from 'remotion';
import type { CSSProperties } from 'react';
import { MOTION } from '../tokens.ts';
import type { Timing } from './timing.ts';

export const REVEAL_PRESETS = ['fade', 'rise', 'sink', 'slideLeft', 'slideRight', 'pop'] as const;
export type RevealPreset = (typeof REVEAL_PRESETS)[number];

/**
 * A long-tailed ease-out: fast enough to feel deliberate, slow enough that the
 * stop is not a snap. Used for everything that travels.
 */
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** Slightly overshooting, for things that should feel placed rather than moved. */
const EASE_POP = Easing.spring({ damping: 200 });

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/**
 * The style for an element arriving at `timing` in a scene that is currently on
 * `frame`. Before the beat it is at its start state, after it is at rest --
 * which is what makes a scene scrubbable: any frame stands on its own.
 */
export function revealStyle(
  preset: RevealPreset,
  frame: number,
  timing: Timing,
  distance: number = MOTION.distance,
): CSSProperties {
  const range = [timing.delay, timing.delay + timing.duration];
  const opacity = interpolate(frame, range, [0, 1], { ...CLAMP, easing: EASE_OUT });

  switch (preset) {
    case 'fade':
      return { opacity };
    case 'rise':
      return {
        opacity,
        translate: interpolate(frame, range, [`0px ${distance}px`, '0px 0px'], {
          ...CLAMP,
          easing: EASE_OUT,
        }),
      };
    case 'sink':
      return {
        opacity,
        translate: interpolate(frame, range, [`0px -${distance}px`, '0px 0px'], {
          ...CLAMP,
          easing: EASE_OUT,
        }),
      };
    case 'slideLeft':
      return {
        opacity,
        translate: interpolate(frame, range, [`${distance * 2}px 0px`, '0px 0px'], {
          ...CLAMP,
          easing: EASE_OUT,
        }),
      };
    case 'slideRight':
      return {
        opacity,
        translate: interpolate(frame, range, [`-${distance * 2}px 0px`, '0px 0px'], {
          ...CLAMP,
          easing: EASE_OUT,
        }),
      };
    case 'pop':
      return {
        opacity: interpolate(frame, range, [0, 1], { ...CLAMP, easing: EASE_OUT }),
        scale: interpolate(frame, range, [0.84, 1], {
          ...CLAMP,
          easing: EASE_POP,
          // Scaling is the one property where linear interpolation looks wrong:
          // the eye reads area, not radius, so the middle of the animation
          // looks like it is lagging.
          output: 'perceptual-scale',
        }),
      };
  }
}

/**
 * A window inside a progress that is already 0 to 1, for a caller animating
 * several things off one beat: a structure whose lines draw and whose nodes
 * land after them has one signal, not two, and this is how a part of it is
 * addressed. Eased like everything else, so a sub-window still arrives the way
 * a beat does.
 */
export function easeBetween(progress: number, from: number, to: number): number {
  return interpolate(progress, [from, to], [0, 1], { ...CLAMP, easing: EASE_OUT });
}

/**
 * A 0-to-1 ramp over a beat, for anything that is not a style: how much of a
 * path to draw, how far a pulse has travelled, how wide a rule has grown. Pair
 * it with `pathLength={1}` on an SVG path so the dash maths does not need to
 * know how long the path actually is.
 */
export function ramp(frame: number, timing: Timing): number {
  return interpolate(frame, [timing.delay, timing.delay + timing.duration], [0, 1], {
    ...CLAMP,
    easing: EASE_OUT,
  });
}
