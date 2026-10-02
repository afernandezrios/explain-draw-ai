/**
 * A rectangle you place yourself.
 *
 * `Surface` decides what a panel *looks* like; `Box` is that panel with
 * geometry -- where it sits in its parent, how big it is, and when it arrives.
 * It is the markup layer's container: a piece of hand-written JSX can put a box
 * at a pixel without a scene computing a rect for it, and a `Connection` then
 * has a rectangle to stop at.
 *
 * The look still comes from `Surface`, so the kit has one implementation of a
 * panel and this adds placement and an entrance, nothing else. That is the
 * difference from `Surface` on purpose: a scene in normal flow uses `Surface`,
 * markup that owns its coordinates uses `Box`. A box may also stay in flow --
 * omit `x`/`y` -- which is how a row of them is drawn.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { RADIUS, type Accent, type Tone } from '../tokens.ts';
import { useEnterStyle } from '../animation/useEnter.ts';
import type { RevealPreset } from '../animation/presets.ts';
import type { Timing } from '../animation/timing.ts';
import { Surface } from './Surface.tsx';

export type BoxProps = {
  children?: React.ReactNode;
  /** Absolute placement in the nearest positioned ancestor. Omit both to let
   * the box sit in flow. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  pad?: number;
  tone?: Tone;
  accent?: Accent;
  radius?: keyof typeof RADIUS;
  outlined?: boolean;
  raised?: boolean;
  /** Centres the children in the box -- for a label in a fixed-size rect. */
  center?: boolean;
  /** When to arrive, in frames from the composition's start. Omit to draw it at
   * rest, which is what a still or an already-placed element wants. */
  enter?: Timing;
  preset?: RevealPreset;
  distance?: number;
  style?: CSSProperties;
};

export const Box: React.FC<BoxProps> = ({
  children,
  x,
  y,
  w,
  h,
  pad = 24,
  tone = 'neutral',
  accent,
  radius = 'lg',
  outlined = true,
  raised = false,
  center = false,
  enter,
  preset = 'rise',
  distance,
  style,
}) => {
  const placed = x !== undefined || y !== undefined;
  const entrance = useEnterStyle(preset, enter, distance);

  return (
    <Surface
      tone={tone}
      accent={accent}
      pad={pad}
      radius={radius}
      outlined={outlined}
      raised={raised}
      style={{
        ...(placed ? { position: 'absolute', left: x ?? 0, top: y ?? 0 } : {}),
        ...(w === undefined ? {} : { width: w }),
        ...(h === undefined ? {} : { height: h }),
        ...(center ? { display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}),
        // The caller's style is the escape hatch and goes before the
        // entrance, so the animation always wins -- the same order `Reveal`
        // documents.
        ...style,
        ...entrance,
      }}
    >
      {children}
    </Surface>
  );
};
