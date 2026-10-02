/**
 * The topology scene: several things, and how they are wired together.
 *
 * Where `FlowScene` is a line, this is a graph. Nodes are placed on an explicit
 * grid -- `col`, `row`, and an optional `span` -- because a layout algorithm
 * that guesses would put the database somewhere different on every run, and a
 * diagram whose parts move between scenes is a diagram the viewer has to
 * re-read. The author knows the shape; the scene computes the pixels.
 *
 * The order the nodes appear in is read out of the edges rather than asked for:
 * a node appears after everything that points at it. That is why a topology
 * cannot arrive in the wrong order -- there is no second place to state it, so
 * there is nothing to disagree with the picture.
 *
 * The cell maths is `lib/grid.ts` and the reciprocal bend is `lib/graph.ts`,
 * both shared with the concept scene's figure: the same cells cannot mean two
 * different rectangles, or two different ways of pulling a pair of arrows
 * apart.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { Accent } from '../tokens.ts';
import type { ThemeProp } from '../theme.tsx';
import { Frame, FrameCaption, useFrameBox } from '../layout/Frame.tsx';
import { DiagramNode } from '../primitives/DiagramNode.tsx';
import { Edge, EdgeLayer } from '../primitives/Edge.tsx';
import type { IconName } from '../primitives/Icon.tsx';
import { segmentBetween } from '../lib/geometry.ts';
import { depthByNode, reciprocalBend } from '../lib/graph.ts';
import { gridBounds, gridRect, type GridBounds } from '../lib/grid.ts';
import { ramp, revealStyle } from '../animation/presets.ts';
import { paceReveals, toFrames, type ScenePace, type Timing } from '../animation/timing.ts';

export type TopologyNode = {
  id: string;
  label: string;
  sublabel?: string;
  icon?: IconName;
  /** Defaults to the scene's accent. */
  accent?: Accent;
  /** 0-based grid cell. */
  col: number;
  row: number;
  /** Columns the node occupies. Defaults to one. */
  span?: number;
};

export type TopologyEdge = {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
  /**
   * How far the line bows out at its middle, in pixels. Two edges running
   * between the same pair of nodes are pulled apart automatically; set this to
   * bow an edge by hand -- a stand-in for a link that goes the long way round.
   */
  bend?: number;
  accent?: Accent;
};

export type TopologySceneProps = {
  title: string;
  eyebrow?: string;
  /** Up to about four rows: the cells get shorter as the count grows. */
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  /** Defaults to the right edge of the widest node. */
  columns?: number;
  /** Defaults to the bottom edge of the lowest node. */
  rows?: number;
  footnote?: string;
  /** Overrides the default depth-by-depth pacing. See `ScenePace`. */
  pace?: ScenePace;
  accent?: Accent;
  theme?: ThemeProp;
};

export const TopologyScene: React.FC<TopologySceneProps> = ({
  title,
  eyebrow,
  nodes,
  edges,
  columns,
  rows,
  footnote,
  pace,
  accent = 'blue',
  theme,
}) => (
  <Frame
    name="Topology scene"
    eyebrow={eyebrow}
    title={title}
    accent={accent}
    theme={theme}
    footer={footnote === undefined ? undefined : <FrameCaption accent={accent}>{footnote}</FrameCaption>}
  >
    <TopologyBody nodes={nodes} edges={edges} columns={columns} rows={rows} pace={pace} accent={accent} />
  </Frame>
);

const TopologyBody: React.FC<{
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  columns?: number;
  rows?: number;
  pace?: ScenePace;
  accent: Accent;
}> = ({ nodes, edges, columns, rows, pace, accent }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const box = useFrameBox();

  const auto = gridBounds(nodes);
  const grid: GridBounds = {
    columns: columns ?? auto.columns,
    rows: rows ?? auto.rows,
  };
  const placed = nodes.map((node) => ({ node, rect: gridRect(node, grid, box) }));
  const rects = new Map(placed.map((entry) => [entry.node.id, entry.rect]));

  const depths = depthByNode(
    nodes.map((node) => node.id),
    edges,
  );
  const maxDepth = Math.max(0, ...depths.values());
  const depthBeats = paceReveals(maxDepth + 1, { fps, durationInFrames, ...pace });
  const duration = depthBeats[0].duration;
  const beatOf = (id: string): Timing => ({
    delay: depthBeats[Math.min(depths.get(id) ?? 0, depthBeats.length - 1)].delay,
    duration,
  });
  // An edge waits for both of its ends and lands a few frames after the later
  // one, so the wiring reads as a consequence of the boxes rather than as part
  // of the same gesture.
  const edgeBeat = (edge: TopologyEdge): Timing => ({
    delay: Math.max(beatOf(edge.from).delay, beatOf(edge.to).delay) + toFrames(0.25, fps),
    duration,
  });

  return (
    <>
      {placed.map(({ node, rect }) => {
        return (
          <div
            key={node.id}
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              ...revealStyle('pop', frame, beatOf(node.id)),
            }}
          >
            <DiagramNode
              label={node.label}
              sublabel={node.sublabel}
              icon={node.icon}
              accent={node.accent ?? accent}
              width={rect.w}
              height={rect.h}
            />
          </div>
        );
      })}

      <EdgeLayer width={box.width} height={box.height}>
        {edges.map((edge, index) => {
          const from = rects.get(edge.from);
          const to = rects.get(edge.to);
          if (from === undefined || to === undefined) {
            // An edge naming a node that is not in the list is dropped here, the
            // same way `depthByNode` drops it: the scene still draws.
            return null;
          }
          const span = segmentBetween(from, to);
          return (
            <Edge
              key={`${edge.from}-${edge.to}-${index}`}
              from={span.from}
              to={span.to}
              progress={ramp(frame, edgeBeat(edge))}
              accent={edge.accent ?? accent}
              dashed={edge.dashed}
              bend={edge.bend ?? reciprocalBend(edge, edges)}
              label={edge.label}
            />
          );
        })}
      </EdgeLayer>
    </>
  );
};
