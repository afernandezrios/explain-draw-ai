/**
 * A word placed in the picture.
 *
 * `Text` is the typography -- it picks a rung of the type scale and a colour.
 * `Label` is that text with a position: markup can hang a word on a point (the
 * middle of an arrow, the corner of a box) without a scene wrapping it in a
 * positioned div, and `anchor` says which part of the words lands on the point.
 *
 * `plate` knocks a piece of the canvas out behind the words. A label that
 * crosses a line or a shape is otherwise read through the thing it is about;
 * the plate is cheaper than moving either of them, and it is the DOM cousin of
 * the halo `Arrow` draws around an SVG label.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { RADIUS, alpha, type Accent, type TextVariant } from '../tokens.ts';
import { useTheme } from '../theme.tsx';
import { useEnterStyle } from '../animation/useEnter.ts';
import type { RevealPreset } from '../animation/presets.ts';
import type { Timing } from '../animation/timing.ts';
import { Text, type TextTone } from './Text.tsx';

/** Which point of the label sits on `x`/`y`: the start, the middle or the end
 * of the words, as with an SVG `text-anchor`. */
export type LabelAnchor = 'start' | 'middle' | 'end';

export type LabelProps = {
  children: React.ReactNode;
  /** Absolute placement in the nearest positioned ancestor. Omit both to let
   * the label sit in flow. */
  x?: number;
  y?: number;
  anchor?: LabelAnchor;
  variant?: TextVariant;
  tone?: TextTone;
  accent?: Accent;
  mono?: boolean;
  clamp?: number;
  align?: CSSProperties['textAlign'];
  /** Draws a knocked-out plate behind the words. */
  plate?: boolean;
  /** When to arrive, in frames from the composition's start. Omit to draw it at
   * rest. */
  enter?: Timing;
  preset?: RevealPreset;
  distance?: number;
  style?: CSSProperties;
};

export const Label: React.FC<LabelProps> = ({
  children,
  x,
  y,
  anchor = 'start',
  variant = 'body',
  tone = 'text',
  accent,
  mono = false,
  clamp,
  align,
  plate = false,
  enter,
  preset = 'rise',
  distance,
  style,
}) => {
  const theme = useTheme();
  const entrance = useEnterStyle(preset, enter, distance);
  const placed = x !== undefined || y !== undefined;
  // A placed label has no width to wrap into, so it holds one line unless the
  // caller asked for a clamp (which needs its own wrapping).
  const oneLine = placed && clamp === undefined;

  const words = (
    <Text
      variant={variant}
      tone={tone}
      accent={accent}
      mono={mono}
      clamp={clamp}
      align={align}
      style={oneLine ? { whiteSpace: 'nowrap' } : undefined}
    >
      {children}
    </Text>
  );

  return (
    <div
      style={{
        ...(placed ? { position: 'absolute', left: x ?? 0, top: y ?? 0 } : {}),
        ...style,
        ...entrance,
      }}
    >
      <div
        style={{
          // The shift lives on the inner box so it cannot collide with the
          // entrance's own `translate`.
          translate: placed && anchor !== 'start' ? (anchor === 'middle' ? '-50% 0px' : '-100% 0px') : undefined,
        }}
      >
        {plate ? (
          <div
            style={{
              display: 'inline-block',
              backgroundColor: alpha(theme.bg, 92),
              borderRadius: RADIUS.sm,
              padding: '3px 10px',
            }}
          >
            {words}
          </div>
        ) : (
          words
        )}
      </div>
    </div>
  );
};
