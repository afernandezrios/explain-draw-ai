/**
 * The two animation channels every markup primitive speaks.
 *
 * A primitive can be told *when* to arrive -- `enter`, a beat in frames, the
 * same `Timing` a scene gets from `paceReveals` -- and it animates itself off
 * the composition's frame clock. Or it can be handed an explicit `progress` by
 * a caller that is already driving one: a travelling pulse, a scene that
 * computes its own windows. An explicit `progress` wins, and neither given
 * means "draw it at rest", which is what a still or a hand-placed element
 * wants.
 *
 * Both hooks exist so the primitives animate the same way instead of each
 * re-deriving `interpolate` with its own clamping, and so the components that
 * are only ever drawn at rest never reach for the frame clock at all.
 *
 * Frames in, frames out: nothing here reads `fps`, so a primitive carries no
 * opinion about the video it is in -- the caller converts seconds through
 * `toFrames` (see `timing.ts`).
 */

import { useCurrentFrame } from 'remotion';
import type { CSSProperties } from 'react';
import { ramp, revealStyle, type RevealPreset } from './presets.ts';
import type { Timing } from './timing.ts';

/**
 * How far along a draw-on is, 0 to 1: the caller's explicit `progress` if it
 * gave one, else the entrance ramp, else fully drawn.
 */
export function useEnterProgress(progress: number | undefined, enter: Timing | undefined): number {
  const frame = useCurrentFrame();
  if (progress !== undefined) {
    return progress;
  }
  return enter === undefined ? 1 : ramp(frame, enter);
}

/**
 * The entrance style for an element that arrives rather than draws: opacity
 * plus whatever the preset moves. Empty when there is no beat, so the element
 * sits at rest.
 */
export function useEnterStyle(
  preset: RevealPreset,
  enter: Timing | undefined,
  distance?: number,
): CSSProperties {
  const frame = useCurrentFrame();
  return enter === undefined ? {} : revealStyle(preset, frame, enter, distance);
}
