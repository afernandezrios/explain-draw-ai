/**
 * The concept scene: one idea, stated in words and then pictured.
 *
 * It exists for the explanations that have no architecture: a definition, a
 * property, a rule of thumb. The words carry the sentence and the figure
 * carries the shape of it -- what is beside what, what leads to what, which
 * part is the one that matters -- because the picture is what makes a
 * definition stick, and a slide of paragraphs is not a picture.
 *
 * The composition is a split: the words on the left, the figure on the right.
 * When there is no figure the scene centres the words instead, which is the one
 * adaptation it makes on its own; `layout` overrides that, and a centred scene
 * with a figure is a poster -- the words, the picture under them, the takeaway
 * closing it.
 *
 * The figure is data, not markup: nodes on a grid, links between them, and one
 * vocabulary of primitives -- a box for a thing, a circle for a value, an arrow
 * or a plain line for a relationship, an icon for a noun, labels on all of
 * them, and a drawn ring for the element the sentence is really about. Nothing
 * here knows what the concept is: every string, shape and accent arrives as a
 * prop.
 *
 * The reveal is one beat per thing that arrives, in reading order: the
 * sentence, then the figure built element by element (a node after everything
 * pointing at it, a link after both of its ends), then the key points, then the
 * takeaway. Pacing comes from `paceReveals`, so a scene told it is twenty
 * seconds long by its narration fills them differently from a demo.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { RADIUS, SPACE, TYPE, alpha, type Accent } from '../tokens.ts';
import { useTheme, type ThemeProp } from '../theme.tsx';
import { Frame, FrameCaption, useFrameBox } from '../layout/Frame.tsx';
import { Center, Column, Row } from '../layout/Stack.tsx';
import { Callout } from '../primitives/Callout.tsx';
import { DiagramNode } from '../primitives/DiagramNode.tsx';
import { Edge, EdgeLayer } from '../primitives/Edge.tsx';
import { Highlight, type HighlightVariant } from '../primitives/Highlight.tsx';
import { Icon, type IconName } from '../primitives/Icon.tsx';
import { Surface } from '../primitives/Surface.tsx';
import { Text } from '../primitives/Text.tsx';
import {
  borderPoint,
  centerOf,
  circleBorderPoint,
  roundedRectPath,
  type Point,
  type Rect,
} from '../lib/geometry.ts';
import { gridBounds, gridRect, type GridBounds, type GridBox } from '../lib/grid.ts';
import { depthByNode, reciprocalBend } from '../lib/graph.ts';
import { ADVANCE, fitFontSize } from '../lib/fit.ts';
import { ramp, revealStyle } from '../animation/presets.ts';
import { paceReveals, staggerTimings, toFrames, type ScenePace, type Timing } from '../animation/timing.ts';
import { useEnterProgress } from '../animation/useEnter.ts';

/** The gap between the words and the figure, in pixels. */
const SPLIT_GAP = 88;
/**
 * The words column: a share of the content box, kept inside bounds that read
 * well. The figure takes what is left, which is why it is the words that are
 * measured and the figure that gives way.
 */
const SPLIT_LEFT_SHARE = 0.4;
const SPLIT_LEFT_MIN = 560;
const SPLIT_LEFT_MAX = 720;
/** The measure a centred scene sets its words to: a line, not a paragraph. */
const CENTERED_WIDTH = 1120;
/**
 * A centred scene with a figure: the share of the body the picture takes, and
 * the bounds that keep a very short scene from handing it everything. The
 * words keep the rest, which is what a poster's caption-sized text wants.
 */
const CENTERED_FIGURE_SHARE = 0.45;
const CENTERED_FIGURE_MIN = 240;
const CENTERED_FIGURE_MAX = 460;
/**
 * A figure's cells are capped rather than stretched, so a two-node picture
 * stays two nodes. Past these the grid is centred in the column instead.
 */
const MAX_CELL_WIDTH = 400;
const MAX_CELL_HEIGHT = 300;
/**
 * The room a *link* needs between two nodes, over and above the room the nodes
 * themselves need: a figure sits in half a canvas, and its arrows carry labels
 * where a topology's can go bare. A reciprocal pair is the case that sets the
 * number -- its two labels are told apart by nothing but the space between the
 * boxes, so the gap has to be wider than a label, which costs cell width.
 */
const LINK_GUTTER_X = 84;
/**
 * Vertical gaps carry labels the same way, on links that run between rows, and
 * a chord between two rows that is shorter than the bow on it reads as a loop
 * rather than as an arrow -- so this is generous too.
 */
const LINK_GUTTER_Y = 64;
/**
 * How far each of a reciprocal pair bows, and so how far apart the pair's two
 * labels sit. The kit's default is sized for a topology's wide cells; a
 * figure's narrower ones need a wider bow before the labels stop touching.
 */
const PAIR_BEND = 48;
/** Seconds a link waits after the later of its two ends has landed. */
const LINK_LAG_SECONDS = 0.25;
/** The emphasis ring: how long after its node it starts, and how long it takes. */
const EMPHASIS_LAG_SECONDS = 0.4;
const EMPHASIS_SECONDS = 0.5;
/** The ring is drawn outside the node's rect, so it never hides its border. */
const RING_PAD = 12;
const RING_WIDTH = 4;
/** The sentence is three lines at most; past that it shrinks, then clips. */
const EXPLANATION_MAX_LINES = 3;
const EXPLANATION_MIN_SIZE = 25;
/** A term's swash starts after the sentence has landed, one term at a time. */
const TERM_LAG_SECONDS = 0.3;
const TERM_STAGGER_SECONDS = 0.18;
const TERM_SWEEP_SECONDS = 0.5;

/** A word in the explanation to mark up as the narration says it. */
export type ConceptTerm = {
  /** The words to find in the explanation. Matched case-insensitively, and a
   * term the sentence does not contain is simply not marked. */
  text: string;
  /** Defaults to the scene's accent. */
  accent?: Accent;
  /** `marker` paints over the words, `underline` points at them. */
  variant?: HighlightVariant;
};

/** One shape in the figure. */
export type ConceptVisualNode = {
  id: string;
  label: string;
  /** The small mono line under the label: a unit, a property, a rate. */
  sublabel?: string;
  icon?: IconName;
  /** `box` is a thing or a system; `circle` is a value, a token, an idea. */
  shape?: 'box' | 'circle';
  /** Defaults to the scene's accent. */
  accent?: Accent;
  /** Draws a ring around it once it has landed: the element to notice. */
  emphasis?: boolean;
  /** 0-based grid cell. */
  col: number;
  row: number;
  /** Columns the node occupies. Defaults to one. */
  span?: number;
};

/** One relationship in the figure. */
export type ConceptVisualLink = {
  from: string;
  to: string;
  label?: string;
  /** `none` draws a plain line: an association rather than a direction. */
  arrow?: 'end' | 'both' | 'none';
  /** The weaker or slower path, drawn dashed. */
  dashed?: boolean;
  /**
   * How far the line bows out at its middle, in pixels. Two links running
   * between the same pair of nodes are pulled apart automatically.
   */
  bend?: number;
  accent?: Accent;
};

export type ConceptVisual = {
  nodes: ConceptVisualNode[];
  links?: ConceptVisualLink[];
  /** Grid size. Defaults to the cells the nodes use. */
  columns?: number;
  rows?: number;
};

export type ConceptTakeaway = {
  body: string;
  /** The block's heading. Defaults to "Key takeaway". */
  label?: string;
  icon?: IconName;
  accent?: Accent;
};

export type ConceptSceneProps = {
  title: string;
  eyebrow?: string;
  /** The concept in one or two sentences. `terms` may mark words in it. */
  explanation: string;
  /** Words in `explanation` to sweep a swash under, in the order they read. */
  terms?: ConceptTerm[];
  /** Two to four short lines under the sentence: the properties worth keeping. */
  keyPoints?: string[];
  /** The picture. Omit it and the scene centres on the words instead. */
  visual?: ConceptVisual;
  /** A closing block: the sentence the scene should be remembered by. */
  takeaway?: ConceptTakeaway;
  /**
   * `auto` splits when there is a figure and centres when there is not.
   * `split` forces the two-column composition, and falls back to centred
   * without a figure. `centered` stacks instead -- the words, then the figure
   * under them -- which suits a short sentence and a wide picture.
   */
  layout?: 'auto' | 'split' | 'centered';
  /** A line in the footer, usually the series or the next section. */
  footnote?: string;
  /** Overrides the default entrance pacing. See `ScenePace`. */
  pace?: ScenePace;
  accent?: Accent;
  theme?: ThemeProp;
};

export const ConceptScene: React.FC<ConceptSceneProps> = ({
  title,
  eyebrow,
  explanation,
  terms,
  keyPoints,
  visual,
  takeaway,
  layout = 'auto',
  footnote,
  pace,
  accent = 'blue',
  theme,
}) => (
  <Frame
    name="Concept scene"
    eyebrow={eyebrow}
    title={title}
    accent={accent}
    theme={theme}
    footer={footnote === undefined ? undefined : <FrameCaption accent={accent}>{footnote}</FrameCaption>}
  >
    <ConceptBody
      explanation={explanation}
      terms={terms}
      keyPoints={keyPoints}
      visual={visual}
      takeaway={takeaway}
      layout={layout}
      pace={pace}
      accent={accent}
    />
  </Frame>
);

type ConceptBodyProps = {
  explanation: string;
  terms?: ConceptTerm[];
  keyPoints?: string[];
  visual?: ConceptVisual;
  takeaway?: ConceptTakeaway;
  layout: 'auto' | 'split' | 'centered';
  pace?: ScenePace;
  accent: Accent;
};

const ConceptBody: React.FC<ConceptBodyProps> = ({
  explanation,
  terms,
  keyPoints = [],
  visual,
  takeaway,
  layout,
  pace,
  accent,
}) => {
  const box = useFrameBox();
  const { fps, durationInFrames } = useVideoConfig();

  // An empty figure is not a figure: the scene falls back to its words rather
  // than reserving a column for nothing.
  // `!= null`, not `!== undefined`: the Studio's props editor writes an
  // explicit null when a key is cleared, and an empty figure is no figure --
  // the scene centres its words rather than drawing an empty grid.
  const figure = visual != null && visual.nodes.length > 0 ? visual : undefined;
  const split = figure !== undefined && layout !== 'centered';

  // One beat per thing that arrives, in the order it is read. The figure's
  // share is one beat per depth level of its own graph; its links land inside
  // those beats rather than spending slots of their own. A centred figure is
  // still a figure, so it is budgeted wherever it is drawn.
  const figureSlots = figure === undefined ? 0 : figureBeatCount(figure);
  const total = 1 + figureSlots + keyPoints.length + (takeaway === undefined ? 0 : 1);
  const beats = paceReveals(Math.max(1, total), { fps, durationInFrames, ...pace });
  let cursor = 0;
  const explanationBeat = beats[cursor++];
  const figureBeats = beats.slice(cursor, cursor + figureSlots);
  cursor += figureSlots;
  const pointBeats = beats.slice(cursor, cursor + keyPoints.length);
  cursor += keyPoints.length;
  const takeawayBeat = takeaway === undefined ? null : beats[cursor];

  if (figure === undefined) {
    return (
      <Center style={{ height: '100%' }}>
        <Column gap={SPACE.xl} style={{ width: CENTERED_WIDTH, maxWidth: '100%' }}>
          <ConceptWords
            explanation={explanation}
            terms={terms}
            keyPoints={keyPoints}
            explanationBeat={explanationBeat}
            pointBeats={pointBeats}
            width={CENTERED_WIDTH}
            accent={accent}
          />
          {takeaway === undefined || takeawayBeat === null ? null : (
            <TakeawayBlock takeaway={takeaway} beat={takeawayBeat} accent={accent} />
          )}
        </Column>
      </Center>
    );
  }

  if (!split) {
    // The poster: the same three blocks the split has, stacked in reading
    // order. The figure's box is a share of the body rather than what the
    // words leave over, so a long sentence and a short one put the picture in
    // the same place -- and a figure told its box does not have to measure one.
    const figureHeight = clamp(box.height * CENTERED_FIGURE_SHARE, CENTERED_FIGURE_MIN, CENTERED_FIGURE_MAX);
    return (
      <Center style={{ height: '100%' }}>
        <Column gap={SPACE.xl} style={{ width: CENTERED_WIDTH, maxWidth: '100%' }}>
          <ConceptWords
            explanation={explanation}
            terms={terms}
            keyPoints={keyPoints}
            explanationBeat={explanationBeat}
            pointBeats={pointBeats}
            width={CENTERED_WIDTH}
            accent={accent}
          />
          <div style={{ position: 'relative', height: figureHeight }}>
            <ConceptFigure
              visual={figure}
              box={{ width: CENTERED_WIDTH, height: figureHeight }}
              beats={figureBeats}
              accent={accent}
            />
          </div>
          {takeaway === undefined || takeawayBeat === null ? null : (
            <TakeawayBlock takeaway={takeaway} beat={takeawayBeat} accent={accent} />
          )}
        </Column>
      </Center>
    );
  }

  const leftWidth = clamp(box.width * SPLIT_LEFT_SHARE, SPLIT_LEFT_MIN, SPLIT_LEFT_MAX);

  return (
    <Row gap={SPLIT_GAP} align="stretch" style={{ height: '100%' }}>
      <Column gap={SPACE.xl} style={{ width: leftWidth, flexShrink: 0 }}>
        <ConceptWords
          explanation={explanation}
          terms={terms}
          keyPoints={keyPoints}
          explanationBeat={explanationBeat}
          pointBeats={pointBeats}
          width={leftWidth}
          accent={accent}
        />
        {/* Pinned to the bottom of the column, so it lines up with the bottom of
            the figure and reads as the scene's conclusion. */}
        {takeaway === undefined || takeawayBeat === null ? null : (
          <TakeawayBlock takeaway={takeaway} beat={takeawayBeat} accent={accent} style={{ marginTop: 'auto' }} />
        )}
      </Column>

      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <ConceptFigure
          visual={figure}
          box={{ width: box.width - leftWidth - SPLIT_GAP, height: box.height }}
          beats={figureBeats}
          accent={accent}
        />
      </div>
    </Row>
  );
};

/** The sentence, and the lines under it. The left column in both layouts. */
const ConceptWords: React.FC<{
  explanation: string;
  terms?: ConceptTerm[];
  keyPoints: string[];
  explanationBeat: Timing;
  pointBeats: Timing[];
  width: number;
  accent: Accent;
}> = ({ explanation, terms, keyPoints, explanationBeat, pointBeats, width, accent }) => (
  <>
    <Explanation text={explanation} terms={terms ?? []} beat={explanationBeat} width={width} accent={accent} />
    {keyPoints.length === 0 ? null : <KeyPoints points={keyPoints} beats={pointBeats} accent={accent} />}
  </>
);

const Explanation: React.FC<{
  text: string;
  terms: ConceptTerm[];
  beat: Timing;
  width: number;
  accent: Accent;
}> = ({ text, terms, beat, width, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const runs = markTerms(text, terms);
  // One sweep per term, in the order the terms are first read, so a term the
  // sentence does not contain costs nothing and shifts nothing.
  const appearing: ConceptTerm[] = [];
  for (const run of runs) {
    if (run.term !== undefined && !appearing.includes(run.term)) {
      appearing.push(run.term);
    }
  }
  const sweeps = staggerTimings(appearing.length, {
    start: beat.delay + toFrames(TERM_LAG_SECONDS, fps),
    step: toFrames(TERM_STAGGER_SECONDS, fps),
    duration: toFrames(TERM_SWEEP_SECONDS, fps),
  });
  // The sentence is the scene's one piece of prose: a long one shrinks rather
  // than ellipsising, up to the floor where the clamp takes over.
  const size = fitFontSize(text, {
    size: TYPE.subheading.fontSize,
    maxWidth: width,
    maxLines: EXPLANATION_MAX_LINES,
    minSize: EXPLANATION_MIN_SIZE,
    advance: ADVANCE.subheading,
  });

  return (
    <Text
      variant="subheading"
      clamp={EXPLANATION_MAX_LINES}
      style={{ fontSize: size, maxWidth: width, ...revealStyle('rise', frame, beat, 24) }}
    >
      {runs.map((run, index) =>
        run.term === undefined ? (
          <React.Fragment key={index}>{run.text}</React.Fragment>
        ) : (
          <Highlight
            key={index}
            variant={run.term.variant}
            accent={run.term.accent ?? accent}
            enter={sweeps[appearing.indexOf(run.term)]}
          >
            {run.text}
          </Highlight>
        ),
      )}
    </Text>
  );
};

const KeyPoints: React.FC<{ points: string[]; beats: Timing[]; accent: Accent }> = ({
  points,
  beats,
  accent,
}) => {
  const theme = useTheme();
  const frame = useCurrentFrame();

  return (
    <Column gap={SPACE.md}>
      {points.map((point, index) => (
        <Row
          key={point}
          gap={16}
          align="flex-start"
          // From the left, the side the list sits on, so a point reads as
          // joining the sentence above it.
          style={revealStyle('slideRight', frame, beats[index], 18)}
        >
          <div
            style={{
              width: 9,
              height: 9,
              marginTop: 16,
              borderRadius: 999,
              flexShrink: 0,
              backgroundColor: alpha(theme.accent[accent], 90),
            }}
          />
          <Text variant="body" tone="secondary" clamp={2} style={{ minWidth: 0 }}>
            {point}
          </Text>
        </Row>
      ))}
    </Column>
  );
};

const TakeawayBlock: React.FC<{
  takeaway: ConceptTakeaway;
  beat: Timing;
  accent: Accent;
  style?: CSSProperties;
}> = ({ takeaway, beat, accent, style }) => {
  const frame = useCurrentFrame();

  return (
    <Callout
      title={takeaway.label ?? 'Key takeaway'}
      body={takeaway.body}
      icon={takeaway.icon ?? 'bolt'}
      accent={takeaway.accent ?? accent}
      style={{ ...style, ...revealStyle('rise', frame, beat, 20) }}
    />
  );
};

/**
 * The picture: nodes placed on their grid, links drawn between them.
 *
 * The order the nodes appear in is read out of the links rather than asked for
 * -- a node arrives after everything pointing at it -- exactly as the topology
 * scene does it, so there is no second place to state the order and nothing for
 * it to disagree with.
 */
const ConceptFigure: React.FC<{
  visual: ConceptVisual;
  box: GridBox;
  beats: Timing[];
  accent: Accent;
}> = ({ visual, box, beats, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const links = visual.links ?? [];
  const auto = gridBounds(visual.nodes);
  const grid: GridBounds = {
    columns: visual.columns ?? auto.columns,
    rows: visual.rows ?? auto.rows,
  };
  const placed = visual.nodes.map((node) => ({ node, rect: nodeRect(node, grid, box) }));
  const rects = new Map(placed.map((entry) => [entry.node.id, entry.rect]));
  const nodesById = new Map(visual.nodes.map((node) => [node.id, node]));

  const depths = depthByNode(
    visual.nodes.map((node) => node.id),
    links,
  );
  const beatOf = (id: string): Timing => beats[Math.min(depths.get(id) ?? 0, beats.length - 1)];
  // A link waits for both of its ends and lands a few frames after the later
  // one, so the wiring reads as a consequence of the shapes rather than as part
  // of the same gesture.
  const linkBeat = (link: ConceptVisualLink): Timing => ({
    delay: Math.max(beatOf(link.from).delay, beatOf(link.to).delay) + toFrames(LINK_LAG_SECONDS, fps),
    duration: beatOf(link.from).duration,
  });

  return (
    <>
      {placed.map(({ node, rect }) => (
        <ConceptNodeView
          key={node.id}
          node={node}
          rect={rect}
          beat={beatOf(node.id)}
          fps={fps}
          frame={frame}
          fallbackAccent={accent}
        />
      ))}

      {/* Above the nodes, as every diagram in the kit is: an arrowhead that
          lands a hair short of a shape is still on screen rather than tucked
          behind it. */}
      <EdgeLayer width={box.width} height={box.height}>
        {links.map((link, index) => {
          const fromNode = nodesById.get(link.from);
          const toNode = nodesById.get(link.to);
          const fromRect = rects.get(link.from);
          const toRect = rects.get(link.to);
          if (
            fromNode === undefined ||
            toNode === undefined ||
            fromRect === undefined ||
            toRect === undefined ||
            link.from === link.to
          ) {
            // A link naming a node that is not in the list -- or itself -- is
            // dropped here, the same way `depthByNode` drops it: the figure
            // still draws.
            return null;
          }
          return (
            <Edge
              key={`${link.from}-${link.to}-${index}`}
              from={endPoint(fromNode, fromRect, centerOf(toRect))}
              to={endPoint(toNode, toRect, centerOf(fromRect))}
              progress={ramp(frame, linkBeat(link))}
              accent={link.accent ?? accent}
              arrow={link.arrow}
              dashed={link.dashed}
              bend={link.bend ?? reciprocalBend(link, links, PAIR_BEND)}
              label={link.label}
            />
          );
        })}
      </EdgeLayer>
    </>
  );
};

const ConceptNodeView: React.FC<{
  node: ConceptVisualNode;
  rect: Rect;
  beat: Timing;
  fps: number;
  frame: number;
  fallbackAccent: Accent;
}> = ({ node, rect, beat, fps, frame, fallbackAccent }) => {
  const accent = node.accent ?? fallbackAccent;
  const circle = node.shape === 'circle';

  return (
    <>
      <div style={{ position: 'absolute', left: rect.x, top: rect.y, ...revealStyle('pop', frame, beat) }}>
        {circle ? (
          <CircleNode node={node} diameter={rect.w} accent={accent} />
        ) : (
          // A box is a `DiagramNode`, the same object the flow and topology
          // scenes draw: it already switches between the stacked and the inline
          // form as its rectangle gets shorter, which is the contract that keeps
          // a label inside the shape its links are anchored to.
          <DiagramNode
            label={node.label}
            sublabel={node.sublabel}
            icon={node.icon}
            accent={accent}
            width={rect.w}
            height={rect.h}
          />
        )}
      </div>
      {node.emphasis === true ? (
        <EmphasisRing
          rect={rect}
          circle={circle}
          accent={accent}
          enter={{ delay: beat.delay + toFrames(EMPHASIS_LAG_SECONDS, fps), duration: toFrames(EMPHASIS_SECONDS, fps) }}
        />
      ) : null}
    </>
  );
};

/**
 * A round node: a value, a token, an idea.
 *
 * It is a `Surface` with a full corner radius rather than a new primitive, and
 * it is sized by the square the figure anchored its links to, so its rim is the
 * shape a link stops at.
 */
const CircleNode: React.FC<{ node: ConceptVisualNode; diameter: number; accent: Accent }> = ({
  node,
  diameter,
  accent,
}) => {
  const theme = useTheme();

  return (
    <Surface
      accent={accent}
      pad={Math.round(diameter * 0.1)}
      style={{
        width: diameter,
        height: diameter,
        borderRadius: 999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Math.round(diameter * 0.05),
      }}
    >
      {node.icon === undefined ? null : (
        <Icon name={node.icon} size={Math.round(Math.min(44, diameter * 0.17))} color={theme.accent[accent]} />
      )}
      <Text variant="subheading" align="center" clamp={2} style={{ fontWeight: 600, width: '100%' }}>
        {node.label}
      </Text>
      {node.sublabel === undefined ? null : (
        <Text variant="small" tone="muted" mono align="center" clamp={1} style={{ width: '100%' }}>
          {node.sublabel}
        </Text>
      )}
    </Surface>
  );
};

/**
 * The ring around the element the sentence is really about.
 *
 * Drawn, not faded in: the stroke sweeps around the shape the way an arrow
 * draws itself, which is the one gesture that marks something *after* the
 * viewer has already seen it.
 */
const EmphasisRing: React.FC<{ rect: Rect; circle: boolean; accent: Accent; enter: Timing }> = ({
  rect,
  circle,
  accent,
  enter,
}) => {
  const theme = useTheme();
  const drawn = useEnterProgress(undefined, enter);
  // The dash trick every draw-on in the kit uses: a normalised path length and
  // a dash that is exactly as long as the path.
  const sweep = {
    fill: 'none',
    stroke: alpha(theme.accent[accent], 75),
    strokeWidth: RING_WIDTH,
    strokeLinecap: 'round' as const,
    pathLength: 1,
    strokeDasharray: '1 1',
    strokeDashoffset: 1 - drawn,
  };

  return (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {circle ? (
        <circle cx={centerOf(rect).x} cy={centerOf(rect).y} r={rect.w / 2 + RING_PAD} {...sweep} />
      ) : (
        <path
          d={roundedRectPath(
            { x: rect.x - RING_PAD, y: rect.y - RING_PAD, w: rect.w + RING_PAD * 2, h: rect.h + RING_PAD * 2 },
            RADIUS.lg + RING_PAD,
          )}
          {...sweep}
        />
      )}
    </svg>
  );
};

/**
 * The rectangle a node is drawn in -- and, because a link stops on it, the
 * rectangle it is anchored by. A circle's is squared around its cell, so the
 * shape on screen and the shape a line is solved against are the same one.
 */
function nodeRect(node: ConceptVisualNode, grid: GridBounds, box: GridBox): Rect {
  const rect = gridRect(node, grid, box, {
    maxCellWidth: MAX_CELL_WIDTH,
    maxCellHeight: MAX_CELL_HEIGHT,
    gutterX: LINK_GUTTER_X,
    gutterY: LINK_GUTTER_Y,
  });
  if (node.shape !== 'circle') {
    return rect;
  }
  const diameter = Math.min(rect.w, rect.h);
  return {
    x: rect.x + (rect.w - diameter) / 2,
    y: rect.y + (rect.h - diameter) / 2,
    w: diameter,
    h: diameter,
  };
}

/** Where a link stops: on a box's border, or on a circle's rim. */
function endPoint(node: ConceptVisualNode, rect: Rect, toward: Point): Point {
  if (node.shape === 'circle') {
    return circleBorderPoint(centerOf(rect), rect.w / 2, toward);
  }
  return borderPoint(rect, toward);
}

/** How many beats a figure needs: one per depth level in its own graph. */
function figureBeatCount(figure: ConceptVisual): number {
  const depths = depthByNode(
    figure.nodes.map((node) => node.id),
    figure.links ?? [],
  );
  return Math.max(1, Math.max(0, ...depths.values()) + 1);
}

type Run = { text: string; term?: ConceptTerm };

/**
 * The sentence split into runs, with every term occurrence found.
 *
 * The longest match wins at any position, so "database index" is one swash
 * rather than "database" plus a second sweep inside it. Matching is
 * case-insensitive and the run keeps the original casing. A term that never
 * appears produces no run, which is why the caller derives a term's beat from
 * the runs rather than from the props.
 */
function markTerms(text: string, terms: ConceptTerm[]): Run[] {
  const lower = text.toLowerCase();
  const runs: Run[] = [];
  let plain = '';
  let index = 0;

  while (index < text.length) {
    const match = termAt(lower, terms, index);
    if (match === null) {
      plain += text[index];
      index += 1;
      continue;
    }
    if (plain.length > 0) {
      runs.push({ text: plain });
      plain = '';
    }
    runs.push({ text: text.slice(index, index + match.length), term: match.term });
    index += match.length;
  }

  if (plain.length > 0) {
    runs.push({ text: plain });
  }
  return runs;
}

function termAt(
  lower: string,
  terms: ConceptTerm[],
  index: number,
): { term: ConceptTerm; length: number } | null {
  let best: { term: ConceptTerm; length: number } | null = null;
  for (const term of terms) {
    const needle = term.text.toLowerCase();
    if (needle.length === 0 || !lower.startsWith(needle, index)) {
      continue;
    }
    if (best === null || needle.length > best.length) {
      best = { term, length: needle.length };
    }
  }
  return best;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
