/**
 * When things happen in a scene.
 *
 * A scene does not know how long it is until it renders, and it should not: the
 * same storyboard is 6 seconds in a preview and 9 in the finished video, because
 * the length that ships is the narration's measured length. So a scene states
 * *how many* beats it has, and `paceReveals` spreads them across whatever
 * `durationInFrames` it was given, leaving the lead-in and tail that MOTION
 * asks for.
 *
 * Slots are computed from the index, never accumulated from a rounded step --
 * the same reason `drawWindows` in the doodle pipeline does it that way: a
 * hundred additions of a rounded 0.4 leave the last element starting after the
 * scene has ended.
 *
 * Frames in, frames out. Callers convert seconds through `toFrames`, so the
 * pacing constants stay readable as seconds in `tokens.ts`.
 */

import { MOTION } from '../tokens.ts';

export type Timing = {
  /** Frames from the scene's first frame to the first frame of this animation. */
  delay: number;
  /** How long the animation runs, in frames. */
  duration: number;
};

export function toFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

export type PaceOptions = {
  fps: number;
  durationInFrames: number;
  leadSeconds?: number;
  tailSeconds?: number;
  enterSeconds?: number;
  /** The ideal gap between beats; compressed when the scene is too short. */
  staggerSeconds?: number;
};

/**
 * The part of a scene's pacing its author may override.
 *
 * `fps` and `durationInFrames` are not here on purpose: they belong to the
 * composition, and a scene is *told* how long it is. But the default stagger is
 * a quick cascade -- the picture is complete while the narration talks over it,
 * which is right for a five-second scene and wrong for a thirty-second one. A
 * scene that has to fill a long narration says so with `pace`, rather than the
 * default being something every scene then has to fight.
 */
export type ScenePace = Partial<Omit<PaceOptions, 'fps' | 'durationInFrames'>>;

/**
 * `count` beats spread across a scene: each starts a stagger after the last and
 * takes `enterSeconds` to arrive, and the whole run finishes at least
 * `tailSeconds` before the scene ends.
 *
 * The stagger is a maximum, not a promise: when the scene cannot fit both the
 * ideal gap and the tail, the gap shrinks so that everything still lands inside
 * the scene. A scene that runs out of room loses its leisurely pace, never its
 * last beat.
 */
export function paceReveals(count: number, options: PaceOptions): Timing[] {
  const { fps, durationInFrames } = options;
  const lead = Math.max(0, toFrames(options.leadSeconds ?? MOTION.leadSeconds, fps));
  const tail = Math.max(0, toFrames(options.tailSeconds ?? MOTION.tailSeconds, fps));
  const available = Math.max(1, durationInFrames - lead - tail);
  const enter = Math.min(Math.max(1, toFrames(options.enterSeconds ?? MOTION.enterSeconds, fps)), available);
  const span = Math.max(0, available - enter);
  const idealStep = Math.max(0, toFrames(options.staggerSeconds ?? MOTION.staggerSeconds, fps));
  const step = count > 1 ? Math.min(idealStep, Math.floor(span / (count - 1))) : 0;

  return Array.from({ length: count }, (_, index) => ({
    delay: lead + index * step,
    duration: enter,
  }));
}

/**
 * The same idea without a scene to fit into: `count` beats starting at `start`,
 * `step` frames apart. For elements inside a beat -- the tags on a title card,
 * the lines of a code block -- where the outer pace is already decided.
 */
export function staggerTimings(
  count: number,
  options: { start: number; step: number; duration: number },
): Timing[] {
  return Array.from({ length: count }, (_, index) => ({
    delay: options.start + index * options.step,
    duration: options.duration,
  }));
}

/**
 * A 0-to-1 signal that repeats every `period` frames, starting at `start`.
 *
 * This is what keeps a flow diagram alive after its last node has arrived: the
 * reveal animations run once and stop, and a picture of a queue with nothing
 * moving in it is a diagram, not an explanation.
 */
export function loopProgress(frame: number, options: { start: number; period: number }): number {
  const { start, period } = options;
  if (period <= 0) {
    return 0;
  }
  const elapsed = frame - start;
  if (elapsed < 0) {
    return 0;
  }
  return (elapsed % period) / period;
}
