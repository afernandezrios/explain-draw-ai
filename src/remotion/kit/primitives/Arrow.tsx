/**
 * A line with a head, between two points.
 *
 * `Edge` is the scene's edge: it lives in a shared `EdgeLayer` and takes two
 * node rectangles a scene has already worked out. `Arrow` is the markup
 * primitive: it carries its own SVG, its own marker definitions and its own
 * coordinates, so a piece of hand-written JSX can draw one between two points
 * without knowing about a layer. `Connection` is the pair-of-boxes case on top
 * of it.
 *
 * The look is deliberately identical to `Edge` -- same chevron, same haloed
 * label, same draw-on -- because the two are the same picture at different
 * levels. The coordinates are pixels in the nearest positioned ancestor, which
 * is the same convention `Box` places its rectangles in.
 *
 * The arrowhead is a marker so it follows the line's tangent, including on a
 * bent arrow, and it is attached only once the line has fully arrived: a marker
 * is painted whether or not its path has dash left to show, so an early
 * arrowhead would hang in mid-air ahead of its own line.
 */

import React, { useId } from 'react';
import type { CSSProperties } from 'react';
import { FONT, alpha, type Accent } from '../tokens.ts';
import { useTheme } from '../theme.tsx';
import { pathBetween, pointOnEdge, type Point } from '../lib/geometry.ts';
import { useEnterProgress } from '../animation/useEnter.ts';
import type { Timing } from '../animation/timing.ts';

export type ArrowProps = {
  from: Point;
  to: Point;
  /** How far the line bows out at its middle, in pixels. Two arrows between
   * the same pair of points are told apart by opposite bends. */
  bend?: number;
  /** How much of the line is drawn, 0 to 1. Overrides `enter`. */
  progress?: number;
  /** When the line draws itself, in frames from the composition's start. Omit
   * to draw it fully. */
  enter?: Timing;
  accent?: Accent;
  /** Overrides `accent`, for a line that is structure rather than meaning. */
  color?: string;
  dashed?: boolean;
  /** Stroke width in pixels. */
  width?: number;
  arrow?: 'end' | 'both' | 'none';
  arrowhead?: 'chevron' | 'solid';
  label?: string;
  /** Where the label sits along the line, 0 to 1. */
  labelAt?: number;
  style?: CSSProperties;
};

export const Arrow: React.FC<ArrowProps> = ({
  from,
  to,
  bend = 0,
  progress,
  enter,
  accent,
  color,
  dashed = false,
  width = 3,
  arrow = 'end',
  arrowhead = 'chevron',
  label,
  labelAt = 0.5,
  style,
}) => {
  const theme = useTheme();
  // Marker ids have to be unique per SVG and are referenced by fragment, so
  // the generated id is stripped to characters a `url(#...)` never has to
  // escape.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const chevronId = `kit-arrow-${uid}-chevron`;
  const solidId = `kit-arrow-${uid}-solid`;

  const draw = useEnterProgress(progress, enter);
  const stroke = color ?? (accent === undefined ? theme.borderStrong : theme.accent[accent]);
  const drawn = draw >= 1;
  const arrowEnd = drawn && (arrow === 'end' || arrow === 'both') ? `url(#${arrowhead === 'solid' ? solidId : chevronId})` : undefined;
  const arrowStart = drawn && arrow === 'both' ? `url(#${arrowhead === 'solid' ? solidId : chevronId})` : undefined;
  const labelPoint = label === undefined ? null : pointOnEdge(from, to, bend, labelAt);

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        // A label or a bend near the edge of its parent is allowed to spill
        // rather than be clipped.
        overflow: 'visible',
        pointerEvents: 'none',
        ...style,
      }}
    >
      <defs>
        <marker
          id={chevronId}
          viewBox="0 0 10 10"
          refX="7.5"
          refY="5"
          markerWidth="11"
          markerHeight="11"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path
            d="M2 1.6 7.6 5 2 8.4"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
        <marker
          id={solidId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="10"
          markerHeight="10"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M1.5 1.4 9 5l-7.5 3.6z" fill="context-stroke" />
        </marker>
      </defs>

      <path
        d={pathBetween(from, to, bend)}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={dashed ? '10 12' : undefined}
        // The draw-on needs a normalised path length, and a dashed line cannot
        // also animate its dash offset -- so a dashed arrow fades in through
        // its opacity instead, exactly as `Edge` does.
        pathLength={dashed ? undefined : 1}
        strokeDashoffset={dashed ? undefined : 1 - draw}
        opacity={dashed ? draw : 1}
        markerEnd={arrowEnd}
        markerStart={arrowStart}
      />

      {labelPoint === null ? null : (
        <text
          x={labelPoint.x}
          y={labelPoint.y - 12}
          fill={theme.textSecondary}
          fontFamily={FONT.mono}
          fontSize={21}
          textAnchor="middle"
          opacity={draw}
          // A halo in the canvas colour, so a label crossing its own line stays
          // readable without a background plate to knock out.
          stroke={alpha(theme.bg, 92)}
          strokeWidth={7}
          paintOrder="stroke"
        >
          {label}
        </text>
      )}
    </svg>
  );
};
