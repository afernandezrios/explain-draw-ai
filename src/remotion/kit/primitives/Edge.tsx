/**
 * The lines between the boxes.
 *
 * An edge is drawn in its own SVG layer above the nodes rather than under them,
 * which is the choice that makes arrowheads always visible: a line that stops
 * exactly on a node's border looks identical either way, but one whose tip is a
 * pixel short would disappear behind the node it points at. The layer is
 * transparent to the pointer and its viewBox matches the content box it fills,
 * so scene coordinates and SVG coordinates are the same numbers.
 *
 * The arrowhead is a marker rather than a second path, so it follows the line's
 * tangent -- including on a bent edge -- and inherits the line's colour through
 * `context-stroke` instead of needing a marker per accent.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import type { Accent } from '../tokens.ts';
import { alpha } from '../tokens.ts';
import { useTheme } from '../theme.tsx';
import { pointOnEdge, pathBetween, type Point } from '../lib/geometry.ts';
import { FONT } from '../tokens.ts';

export type EdgeLayerProps = {
  width: number;
  height: number;
  children: React.ReactNode;
  style?: CSSProperties;
};

export const EdgeLayer: React.FC<EdgeLayerProps> = ({ width, height, children, style }) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        // Labels and arrowheads near the edge of the content box are allowed to
        // spill into the scene's padding rather than being clipped.
        overflow: 'visible',
        pointerEvents: 'none',
        ...style,
      }}
    >
      <defs>
        <marker
          id="kit-arrow-chevron"
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
          id="kit-arrow-solid"
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
      {children}
    </svg>
  );
};

export type EdgeProps = {
  from: Point;
  to: Point;
  /** How much of the line is drawn, 0 to 1, from `ramp`. Defaults to all. */
  progress?: number;
  accent?: Accent;
  /** Overrides `accent`; for a line that is structure rather than meaning. */
  color?: string;
  dashed?: boolean;
  width?: number;
  /** How far the line bows out at its middle, in pixels. Two edges between the
   * same pair of nodes are told apart by opposite bends. */
  bend?: number;
  arrow?: 'end' | 'both' | 'none';
  arrowhead?: 'chevron' | 'solid';
  label?: string;
  /** Where the label sits along the line, 0 to 1. */
  labelAt?: number;
};

export const Edge: React.FC<EdgeProps> = ({
  from,
  to,
  progress = 1,
  accent,
  color,
  dashed = false,
  width = 3,
  bend = 0,
  arrow = 'end',
  arrowhead = 'chevron',
  label,
  labelAt = 0.5,
}) => {
  const theme = useTheme();
  const stroke = color ?? (accent === undefined ? theme.borderStrong : theme.accent[accent]);

  // A marker is painted whether or not its path has any dash left to show, so
  // an arrowhead attached to a path that has not been drawn yet would hang in
  // mid-air. It is attached on the frame the line lands instead.
  const drawn = progress >= 1;
  const arrowEnd = drawn && (arrow === 'end' || arrow === 'both') ? `url(#kit-arrow-${arrowhead})` : undefined;
  const arrowStart = drawn && arrow === 'both' ? `url(#kit-arrow-${arrowhead})` : undefined;

  const labelPoint = label === undefined ? null : pointOnEdge(from, to, bend, labelAt);

  return (
    <>
      <path
        d={pathBetween(from, to, bend)}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={dashed ? '10 12' : undefined}
        // The dash trick needs a normalised path length, and a dashed line
        // cannot also animate its dash offset -- so a dashed edge fades in
        // through its opacity instead of drawing on.
        pathLength={dashed ? undefined : 1}
        strokeDashoffset={dashed ? undefined : 1 - progress}
        opacity={dashed ? progress : 1}
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
          opacity={progress}
          // A halo in the canvas colour, so a label crossing its own line stays
          // readable without a background plate to knock out.
          stroke={alpha(theme.bg, 92)}
          strokeWidth={7}
          paintOrder="stroke"
        >
          {label}
        </text>
      )}
    </>
  );
};
