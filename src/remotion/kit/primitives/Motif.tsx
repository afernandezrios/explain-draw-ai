/**
 * The structure behind a card: nodes and the lines between them, or a field of
 * dots, drawn well below the contrast of anything a viewer is meant to read.
 *
 * A title card with nothing but type on it is a slide; the room behind the
 * words is where a video's subject shows itself before a word has been read.
 * This is that room -- a technical shape at roughly a fifth of the canvas'
 * contrast, never a diagram, never labelled, never in front of text. It is
 * decoration by contract: `pointerEvents: none`, `aria-hidden`, and every
 * colour derived from the scene's accent so it can never fight it.
 *
 * It is deliberately not the grid `Frame` already draws. That grid is the
 * canvas; this is a picture of a system, and the two can be on at once without
 * either being redundant.
 *
 * Like the markup primitives, it animates off `progress` (a caller that is
 * already driving a beat) or `enter` (a beat of its own), and draws at rest
 * when given neither -- which is what a still or a hand-placed element wants.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { alpha, type Accent } from '../tokens.ts';
import { useTheme } from '../theme.tsx';
import { useEnterProgress } from '../animation/useEnter.ts';
import { easeBetween } from '../animation/presets.ts';
import type { Timing } from '../animation/timing.ts';

export const MOTIF_VARIANTS = ['nodes', 'dots'] as const;
export type MotifVariant = (typeof MOTIF_VARIANTS)[number];

export type MotifProps = {
  variant?: MotifVariant;
  accent?: Accent;
  /** How far the structure is drawn, 0 to 1. Overrides `enter`. */
  progress?: number;
  /** When the structure draws itself, in frames from the composition's start.
   * Omit, with no `progress`, to draw it at rest. */
  enter?: Timing;
  /** Overall strength, 0 to 1. The default is already faint. */
  intensity?: number;
  style?: CSSProperties;
};

/** The box the geometry below is authored in. It scales by being placed, not
 * by a viewBox, so a node stays round at any size the caller wants. */
const WIDTH = 480;
const HEIGHT = 560;

type Node = { x: number; y: number; r: number; hub?: boolean };

/**
 * One system, hand-placed in three tiers: three services on the left, two in
 * the middle, one hub they converge on. Deliberately *not* an even scatter --
 * a random constellation reads as decoration, while a fan-in reads as a system
 * the way a circuit reads as a circuit, long before anything is labelled.
 */
const NODES: Node[] = [
  { x: 62, y: 104, r: 5 },
  { x: 78, y: 286, r: 7 },
  { x: 58, y: 462, r: 5 },
  { x: 238, y: 186, r: 6 },
  { x: 248, y: 380, r: 6 },
  { x: 414, y: 282, r: 11, hub: true },
  { x: 372, y: 96, r: 4 },
  { x: 384, y: 470, r: 4 },
];

/** The one node the rest converge on, found rather than indexed so the array
 * above can be reordered without the ring drifting off its node. */
const HUB = NODES.find((node) => node.hub === true) ?? NODES[0];

const EDGES: Array<[number, number]> = [
  [0, 3],
  [1, 3],
  [1, 4],
  [2, 4],
  [3, 5],
  [4, 5],
  [3, 6],
  [6, 5],
  [4, 7],
  [7, 5],
];

const DOT_COLUMNS = 7;
const DOT_ROWS = 9;
const DOT_STEP_X = 72;
const DOT_STEP_Y = 64;

/**
 * A stable 0-to-1 from two integers, so the dot field has the same irregularity
 * on every frame and in every render. `Math.imul` keeps the arithmetic exact
 * 32-bit -- a `.sin()` hash would be at the mercy of the engine's float
 * behaviour, and this is a picture that must not change between takes.
 */
function hash(index: number, salt: number): number {
  const mixed = Math.imul(index + 1, 374761393) ^ Math.imul(salt + 1, 668265263);
  return ((mixed >>> 0) % 10000) / 10000;
}

const NodesMotif: React.FC<{ progress: number; tint: string }> = ({ progress, tint }) => (
  <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} fill="none">
    {EDGES.map(([from, to], index) => {
      // Each line takes its turn, so the graph assembles as a structure rather
      // than arriving as a finished drawing. Every window closes at or before
      // 1: a window that ran past it would leave its element short of arrived
      // for the rest of the shot.
      const share = index / Math.max(1, EDGES.length - 1);
      const drawn = easeBetween(progress, 0.06 + share * 0.4, 0.06 + share * 0.4 + 0.3);
      const a = NODES[from];
      const b = NODES[to];
      return (
        <path
          key={`${from}-${to}`}
          d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`}
          stroke={alpha(tint, 12)}
          strokeWidth={1.25}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - drawn}
        />
      );
    })}

    {NODES.map((node, index) => {
      const share = index / Math.max(1, NODES.length - 1);
      const arrived = easeBetween(progress, 0.42 + share * 0.3, 0.42 + share * 0.3 + 0.28);
      return (
        <circle
          key={`${node.x}-${node.y}`}
          cx={node.x}
          cy={node.y}
          // The radius grows into place, which reads as landfall without the
          // scale-and-overshoot that would make a background element demand
          // attention.
          r={node.r * (0.72 + 0.28 * arrived)}
          fill={alpha(tint, node.hub === true ? 42 : 24)}
          opacity={arrived}
        />
      );
    })}

    {/* A single ring around the hub, sized in whole nodes, so the shape has a
        centre of gravity before a single node has been read. */}
    <circle
      cx={HUB.x}
      cy={HUB.y}
      r={42}
      stroke={alpha(tint, 10)}
      strokeWidth={1.25}
      opacity={easeBetween(progress, 0.5, 1)}
    />
  </svg>
);

const DotsMotif: React.FC<{ progress: number; tint: string }> = ({ progress, tint }) => {
  const dots: React.ReactNode[] = [];
  const span = DOT_COLUMNS + DOT_ROWS - 2;

  for (let row = 0; row < DOT_ROWS; row += 1) {
    for (let column = 0; column < DOT_COLUMNS; column += 1) {
      const index = row * DOT_COLUMNS + column;
      // The field fills on the diagonal, so it reads as one surface arriving
      // rather than as a hundred independent dots.
      const order = (column + row) / span;
      const arrived = easeBetween(progress, 0.05 + order * 0.55, 0.05 + order * 0.55 + 0.4);
      if (arrived <= 0) {
        continue;
      }
      const x = 26 + column * DOT_STEP_X + (hash(index, 1) - 0.5) * 22;
      const y = 24 + row * DOT_STEP_Y + (hash(index, 2) - 0.5) * 22;
      const r = 1.8 + hash(index, 3) * 2.6;
      dots.push(<circle key={index} cx={x} cy={y} r={r} fill={alpha(tint, 22)} opacity={arrived} />);
    }
  }

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} fill="none">
      {dots}
    </svg>
  );
};

export const Motif: React.FC<MotifProps> = ({
  variant = 'nodes',
  accent = 'blue',
  progress,
  enter,
  intensity = 1,
  style,
}) => {
  const theme = useTheme();
  const tint = theme.accent[accent];
  const drawn = useEnterProgress(progress, enter);

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        opacity: intensity,
        ...style,
      }}
    >
      {variant === 'nodes' ? (
        <NodesMotif progress={drawn} tint={tint} />
      ) : (
        <DotsMotif progress={drawn} tint={tint} />
      )}
    </div>
  );
};
