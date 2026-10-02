/**
 * The flow scene: one thing leading to the next, in order.
 *
 * The chain is the most reused picture in technical explanation -- request to
 * handler to store, producer to topic to consumer, a request's path through a
 * cache to an origin -- so it is a scene of its own rather than something each
 * script rebuilds out of boxes and arrows.
 *
 * The order is carried in the pacing: node, arrow, node, arrow. The picture
 * reads left to right (or top to bottom) because it is drawn that way, a beat
 * at a time, and each arrow lands between the boxes it joins rather than on top
 * of them.
 *
 * Geometry is computed rather than left to flexbox, because an edge has to know
 * where a node's border is, and that is a number only this file has.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { alpha, type Accent } from '../tokens.ts';
import { useTheme, type ThemeProp } from '../theme.tsx';
import { Frame, FrameCaption, useFrameBox, type FrameBox } from '../layout/Frame.tsx';
import { DiagramNode, NODE_DEFAULT_HEIGHT } from '../primitives/DiagramNode.tsx';
import { Edge, EdgeLayer } from '../primitives/Edge.tsx';
import type { IconName } from '../primitives/Icon.tsx';
import { centerOf, pointAlong, segmentBetween, type Point, type Rect } from '../lib/geometry.ts';
import { ramp, revealStyle } from '../animation/presets.ts';
import { loopProgress, paceReveals, toFrames, type ScenePace } from '../animation/timing.ts';

/** Seconds the pulse spends crossing one hop, and its floor for a short chain. */
const PULSE_HOP_SECONDS = 0.85;
const PULSE_MIN_SECONDS = 1.4;

export type FlowStep = {
  label: string;
  /** The small mono line under the label: a port, a version, a technology. */
  sublabel?: string;
  icon?: IconName;
  /** Defaults to the scene's accent. */
  accent?: Accent;
};

export type FlowSceneProps = {
  title: string;
  eyebrow?: string;
  /** Three to five read well; past that the boxes are too narrow to label. */
  steps: FlowStep[];
  /** `edges[i]` labels the arrow from step `i` to step `i + 1`. */
  edges?: (string | null)[];
  direction?: 'horizontal' | 'vertical';
  /** A packet that keeps travelling the chain after the last node lands. */
  pulse?: boolean;
  footnote?: string;
  /** Overrides the default entrance pacing. See `ScenePace`. */
  pace?: ScenePace;
  accent?: Accent;
  theme?: ThemeProp;
};

export const FlowScene: React.FC<FlowSceneProps> = ({
  title,
  eyebrow,
  steps,
  edges,
  direction = 'horizontal',
  pulse = false,
  footnote,
  pace,
  accent = 'blue',
  theme,
}) => (
  <Frame
    name="Flow scene"
    eyebrow={eyebrow}
    title={title}
    accent={accent}
    theme={theme}
    footer={footnote === undefined ? undefined : <FrameCaption accent={accent}>{footnote}</FrameCaption>}
  >
    <FlowBody steps={steps} edges={edges} direction={direction} pulse={pulse} pace={pace} accent={accent} />
  </Frame>
);

const FlowBody: React.FC<{
  steps: FlowStep[];
  edges?: (string | null)[];
  direction: 'horizontal' | 'vertical';
  pulse: boolean;
  pace?: ScenePace;
  accent: Accent;
}> = ({ steps, edges, direction, pulse, pace, accent }) => {
  const theme = useTheme();
  const box = useFrameBox();
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const count = steps.length;
  const rects = direction === 'horizontal' ? horizontalRects(box, count) : verticalRects(box, count);
  // A beat for every node and every arrow between them, interleaved, so the
  // picture is built in the order it is read.
  const beats = paceReveals(Math.max(1, count * 2 - 1), { fps, durationInFrames, ...pace });
  const nodeBeat = (index: number) => beats[index * 2];
  const edgeBeat = (index: number) => beats[index * 2 + 1];

  const last = beats[beats.length - 1];
  const pulseStart = last.delay + last.duration + toFrames(0.15, fps);
  // The loop is as long as the chain is: a fixed duration would make the packet
  // visibly speed up as hops were added, and the point of the pulse is that it
  // reads as one constant rate through the system.
  const pulsePeriod = toFrames(
    Math.max(PULSE_MIN_SECONDS, PULSE_HOP_SECONDS * Math.max(1, count - 1)),
    fps,
  );

  return (
    <>
      {/* The pulse sits *under* the nodes, so it is hidden while it is inside a
          box and only visible crossing the gaps: a packet moving through the
          system, rather than a dot sliding over the picture. */}
      {!pulse || count < 2 ? null : (
        <EdgeLayer width={box.width} height={box.height}>
          <Pulse
            points={rects.map(centerOf)}
            progress={loopProgress(frame, { start: pulseStart, period: pulsePeriod })}
            color={theme.accent[accent]}
          />
        </EdgeLayer>
      )}

      {rects.map((rect, index) => (
        <div
          key={`${index}-${steps[index].label}`}
          style={{
            position: 'absolute',
            left: rect.x,
            top: rect.y,
            ...revealStyle('pop', frame, nodeBeat(index)),
          }}
        >
          <DiagramNode
            label={steps[index].label}
            sublabel={steps[index].sublabel}
            icon={steps[index].icon}
            accent={steps[index].accent ?? accent}
            width={rect.w}
            height={rect.h}
          />
        </div>
      ))}

      {/* Above the nodes, so an arrowhead that lands a hair short of a box is
          still on screen rather than tucked behind it. */}
      <EdgeLayer width={box.width} height={box.height}>
        {steps.slice(0, -1).map((step, index) => {
          const span = segmentBetween(rects[index], rects[index + 1]);
          return (
            <Edge
              key={`${index}-${step.label}-${steps[index + 1].label}`}
              from={span.from}
              to={span.to}
              progress={ramp(frame, edgeBeat(index))}
              // The arrow takes the colour of the node it leaves, so a chain
              // written in two accents reads as a hand-off.
              accent={step.accent ?? accent}
              label={edges?.[index] ?? undefined}
            />
          );
        })}
      </EdgeLayer>
    </>
  );
};

/** A dot at a point along the chain, faded in and out at the ends of its loop. */
const Pulse: React.FC<{ points: Point[]; progress: number; color: string }> = ({
  points,
  progress,
  color,
}) => {
  const point = pointAlong(points, progress);
  const fade = Math.min(1, progress / 0.08, (1 - progress) / 0.08);
  if (fade <= 0) {
    return null;
  }
  return (
    <>
      <circle cx={point.x} cy={point.y} r={22} fill={alpha(color, 20)} opacity={fade} />
      <circle cx={point.x} cy={point.y} r={9} fill={color} opacity={fade} />
    </>
  );
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * A row of boxes sized to the gap between them.
 *
 * The width is solved rather than fixed: `n` boxes and `n - 1` gaps have to add
 * up to the content box, and the ideal gap -- enough for an arrow and its label
 * -- is what gives way when the boxes have already hit their maximum. When
 * neither term fills the box, the row is centred instead of stretched, so three
 * steps do not end up marooned at the far edges of the canvas.
 */
function horizontalRects(box: FrameBox, count: number): Rect[] {
  const IDEAL_GAP = 112;
  const MIN_GAP = 44;
  const MAX_GAP = 232;
  const width = clamp((box.width - (count - 1) * IDEAL_GAP) / count, 180, 340);
  const gap = clamp(count > 1 ? (box.width - count * width) / (count - 1) : 0, MIN_GAP, MAX_GAP);
  const height = Math.min(NODE_DEFAULT_HEIGHT, box.height);
  const used = count * width + (count - 1) * gap;
  const left = (box.width - used) / 2;
  const top = (box.height - height) / 2;
  return Array.from({ length: count }, (_, index) => ({
    x: left + index * (width + gap),
    y: top,
    w: width,
    h: height,
  }));
}

/**
 * A column of boxes. Same solve as the row, on the other axis; the boxes come
 * out short enough to take `DiagramNode`'s inline form, which is what a
 * one-label-per-step vertical chain wants.
 */
function verticalRects(box: FrameBox, count: number): Rect[] {
  const IDEAL_GAP = 60;
  const MIN_GAP = 36;
  const MAX_GAP = 104;
  const width = Math.min(620, box.width);
  const height = clamp((box.height - (count - 1) * IDEAL_GAP) / count, 96, 148);
  const gap = clamp(count > 1 ? (box.height - count * height) / (count - 1) : 0, MIN_GAP, MAX_GAP);
  const used = count * height + (count - 1) * gap;
  const top = (box.height - used) / 2;
  const left = (box.width - width) / 2;
  return Array.from({ length: count }, (_, index) => ({
    x: left,
    y: top + index * (height + gap),
    w: width,
    h: height,
  }));
}
