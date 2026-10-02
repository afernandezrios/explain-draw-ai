/**
 * The sequence scene: who talks to whom, and in what order.
 *
 * This is the picture a flow scene cannot draw -- the same two actors appearing
 * several times, a reply that goes back the way it came, a service calling
 * itself. Time runs down the page: the actors are fixed at the top, their
 * lifelines hang below them, and every message is a row.
 *
 * The kinds are a small vocabulary on purpose. `request` is the solid call,
 * `response` the quiet dashed reply, `async` a dashed line that still ends in a
 * solid point because nobody is waiting for it. Colour follows the sender, so a
 * diagram with three services reads as three speakers rather than as three
 * arrow styles.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT, alpha, type Accent } from '../tokens.ts';
import { useTheme, type ThemeProp } from '../theme.tsx';
import { Frame, FrameCaption, useFrameBox } from '../layout/Frame.tsx';
import { DiagramNode } from '../primitives/DiagramNode.tsx';
import { Edge, EdgeLayer } from '../primitives/Edge.tsx';
import type { IconName } from '../primitives/Icon.tsx';
import { selfLoopPath } from '../lib/geometry.ts';
import { ramp, revealStyle } from '../animation/presets.ts';
import { paceReveals, toFrames, type ScenePace, type Timing } from '../animation/timing.ts';

export type SequenceActor = {
  id: string;
  label: string;
  icon?: IconName;
  /** Defaults to the scene's accent. */
  accent?: Accent;
};

export type SequenceMessage = {
  from: string;
  /** The same id as `from` draws the message an actor sends itself. */
  to: string;
  label: string;
  kind?: 'request' | 'response' | 'async';
  /** A second, quieter line under the label: a status code, a payload, a topic. */
  note?: string;
};

export type SequenceSceneProps = {
  title: string;
  eyebrow?: string;
  /** Two to five: the lanes get narrow past that. */
  actors: SequenceActor[];
  /** Five or six rows fit; the rows shrink as the list grows. */
  messages: SequenceMessage[];
  footnote?: string;
  /** Overrides the default one-beat-per-message pacing. See `ScenePace`. */
  pace?: ScenePace;
  accent?: Accent;
  theme?: ThemeProp;
};

export const SequenceScene: React.FC<SequenceSceneProps> = ({
  title,
  eyebrow,
  actors,
  messages,
  footnote,
  pace,
  accent = 'blue',
  theme,
}) => (
  <Frame
    name="Sequence scene"
    eyebrow={eyebrow}
    title={title}
    accent={accent}
    theme={theme}
    footer={footnote === undefined ? undefined : <FrameCaption accent={accent}>{footnote}</FrameCaption>}
  >
    <SequenceBody actors={actors} messages={messages} pace={pace} accent={accent} />
  </Frame>
);

const ACTOR_HEIGHT = 96;
const ACTOR_MAX_WIDTH = 300;
const ACTOR_GAP = 36;
/** Frames the lifelines take to draw down at the start of the scene. */
const LIFELINE_SECONDS = 0.5;

const SequenceBody: React.FC<{
  actors: SequenceActor[];
  messages: SequenceMessage[];
  pace?: ScenePace;
  accent: Accent;
}> = ({ actors, messages, pace, accent }) => {
  const theme = useTheme();
  const box = useFrameBox();
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const laneWidth = actors.length === 0 ? box.width : box.width / actors.length;
  const lanes = new Map(actors.map((actor, index) => [actor.id, (index + 0.5) * laneWidth]));
  const actorWidth = Math.max(120, Math.min(laneWidth - ACTOR_GAP, ACTOR_MAX_WIDTH));

  // One beat for the cast, then one per message: the actors are the frame the
  // rest of the picture is read against, so they arrive first and together.
  const beats = paceReveals(messages.length + 1, { fps, durationInFrames, ...pace });
  const castBeat = beats[0];
  const messageBeat = (index: number): Timing => beats[index + 1];

  const lifelineTop = ACTOR_HEIGHT + 30;
  const rowsTop = ACTOR_HEIGHT + 56;
  const available = Math.max(60, box.height - rowsTop - 12);
  const rowHeight = Math.min(118, available / Math.max(1, messages.length));
  const rowsOffset = rowsTop + (available - rowHeight * messages.length) / 2;
  const rowY = (index: number) => rowsOffset + rowHeight * (index + 0.5);

  const lifelineProgress = ramp(frame, {
    delay: castBeat.delay,
    duration: toFrames(LIFELINE_SECONDS, fps),
  });
  // The lifeline draws on with the same `pathLength={1}` trick the edges use,
  // which also means its dash array is measured in fractions of the line rather
  // than in pixels: a "2 on, 10 off" dot has to be written as 2/length.
  const lifelineLength = Math.max(1, box.height - lifelineTop);
  const lifelineDash = `${2 / lifelineLength} ${10 / lifelineLength}`;

  return (
    <>
      {actors.map((actor) => {
        const lane = lanes.get(actor.id) ?? 0;
        return (
          <div
            key={actor.id}
            style={{
              position: 'absolute',
              left: lane - actorWidth / 2,
              top: 0,
              // From above: the cast drops into place, which reads as a
              // timeline being set up rather than as cards appearing.
              ...revealStyle('sink', frame, castBeat, 18),
            }}
          >
            <DiagramNode
              label={actor.label}
              icon={actor.icon}
              accent={actor.accent ?? accent}
              width={actorWidth}
              height={ACTOR_HEIGHT}
            />
          </div>
        );
      })}

      <EdgeLayer width={box.width} height={box.height}>
        {actors.map((actor) => {
          const lane = lanes.get(actor.id) ?? 0;
          return (
            <line
              key={actor.id}
              x1={lane}
              y1={lifelineTop}
              x2={lane}
              y2={box.height}
              stroke={alpha(theme.accent[actor.accent ?? accent], 34)}
              strokeWidth={2}
              strokeLinecap="round"
              // A fine dot rather than the message-length dash of `Edge`: a
              // lifeline is a background rule, not a thing that travels.
              strokeDasharray={lifelineDash}
              pathLength={1}
              strokeDashoffset={1 - lifelineProgress}
            />
          );
        })}

        {messages.map((message, index) => {
          const from = lanes.get(message.from);
          const to = lanes.get(message.to);
          if (from === undefined || to === undefined) {
            // A message naming an actor that is not on stage is skipped: the
            // diagram still draws, and the missing row is visible as a gap.
            return null;
          }
          const y = rowY(index);
          const beat = messageBeat(index);
          const kind = message.kind ?? 'request';
          const sender = actors.find((actor) => actor.id === message.from);
          const tint = sender?.accent ?? accent;
          // A reply is the quiet line: it answers, it does not announce.
          const color = kind === 'response' ? theme.textMuted : theme.accent[tint];

          if (message.from === message.to) {
            return (
              <SelfMessage
                key={`${message.from}-${index}`}
                x={from}
                y={y}
                // The last actor in a lane has no room to loop rightwards, so
                // the loop turns inward and its label reads back towards the
                // lifeline instead of off the edge of the canvas.
                flip={from > box.width * 0.62}
                progress={ramp(frame, beat)}
                color={color}
                dashed={kind === 'async'}
                label={message.label}
                note={message.note}
              />
            );
          }

          return (
            <React.Fragment key={`${message.from}-${message.to}-${index}`}>
              <Edge
                from={{ x: from, y }}
                to={{ x: to, y }}
                progress={ramp(frame, beat)}
                color={color}
                dashed={kind !== 'request'}
                arrowhead={kind === 'async' ? 'solid' : 'chevron'}
                label={message.label}
              />
              {message.note === undefined ? null : (
                <text
                  x={(from + to) / 2}
                  y={y + 30}
                  fill={theme.textMuted}
                  fontFamily={FONT.mono}
                  fontSize={19}
                  textAnchor="middle"
                  opacity={ramp(frame, beat)}
                  stroke={alpha(theme.bg, 92)}
                  strokeWidth={7}
                  paintOrder="stroke"
                >
                  {message.note}
                </text>
              )}
            </React.Fragment>
          );
        })}
      </EdgeLayer>
    </>
  );
};

/**
 * A message an actor sends itself.
 *
 * Drawn here rather than through `Edge` because it is not a line between two
 * points: it is a loop out of a lifeline and back into it, which `selfLoopPath`
 * draws as a single cubic. Same dash trick as `Edge` for the draw-on, and the
 * same marker, so a self-message looks like every other message that happens to
 * go the long way round.
 */
const SelfMessage: React.FC<{
  x: number;
  y: number;
  flip: boolean;
  progress: number;
  color: string;
  dashed: boolean;
  label: string;
  note?: string;
}> = ({ x, y, flip, progress, color, dashed, label, note }) => {
  const theme = useTheme();
  const reach = (flip ? -1 : 1) * 96;
  const drop = 40;

  return (
    <>
      <path
        d={selfLoopPath({ x, y }, reach, drop)}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={dashed ? '10 12' : undefined}
        pathLength={dashed ? undefined : 1}
        strokeDashoffset={dashed ? undefined : 1 - progress}
        opacity={dashed ? progress : 1}
        markerEnd={progress >= 1 ? 'url(#kit-arrow-chevron)' : undefined}
      />
      <text
        x={x + reach + (flip ? -16 : 16)}
        y={y + drop / 2 + 8}
        fill={theme.textSecondary}
        fontFamily={FONT.mono}
        fontSize={21}
        textAnchor={flip ? 'end' : 'start'}
        opacity={progress}
      >
        {label}
        {note === undefined ? null : (
          <tspan fill={theme.textMuted} fontSize={19} dx={12}>
            {note}
          </tspan>
        )}
      </text>
    </>
  );
};
