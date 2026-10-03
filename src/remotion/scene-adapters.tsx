/**
 * Storyboard scene -> block props.
 *
 * The storyboard and the blocks talk about the same things in different
 * languages: accents are names on one side and hexes on the other, a theme is
 * optional here and defaulted there, and only a block knows how long its own
 * choreography runs. Every translation lives in this one file, so `Scene.tsx`
 * stays a single dispatch line per kind and no block ever grows a branch about
 * the schema.
 */

import type { Accent, Scene, Theme } from '../lib/schema.ts';
import type { CodeRevealProps } from '@/remotion/scenes/code-reveal';
import type { ConceptProps } from '@/remotion/scenes/concept';
import type { DataFlowPipesProps } from '@/remotion/scenes/data-flow-pipes';
import type { FeatureListProps } from '@/remotion/scenes/feature-list';
import type { OrgChartBuildProps } from '@/remotion/scenes/org-chart-build';
import type { TimelineStepsProps } from '@/remotion/scenes/timeline-steps';
import type { TitleCardProps } from '@/remotion/scenes/title-card';
import { conceptTimeline } from '@/remotion/scenes/concept';

type TitleScene = Extract<Scene, { kind: 'title' }>;
type PointsScene = Extract<Scene, { kind: 'points' }>;
type FlowScene = Extract<Scene, { kind: 'flow' }>;
type TopologyScene = Extract<Scene, { kind: 'topology' }>;
type SequenceScene = Extract<Scene, { kind: 'sequence' }>;
type CodeScene = Extract<Scene, { kind: 'code' }>;
type ConceptScene = Extract<Scene, { kind: 'concept' }>;

/** The light-theme accents every block in the kit draws from, as hex. */
export const ACCENT_HEX: Record<Accent, string> = {
  blue: '#2563eb',
  cyan: '#0e9bb5',
  violet: '#7c3aed',
  green: '#0e9f6e',
  amber: '#d97706',
  rose: '#e11d48',
};

/** The accents in the order the map declares them (insertion order). */
const ACCENT_ORDER = Object.keys(ACCENT_HEX) as Accent[];

/** Hex for a storyboard accent; `undefined` means "the block's own default". */
export function accentHex(accent: Accent | null | undefined): string | undefined {
  return accent == null ? undefined : ACCENT_HEX[accent];
}

/** The blocks default to their dark look, which is what a null theme means. */
export function themeFor(theme: Theme | null | undefined): Theme {
  return theme ?? 'dark';
}

/**
 * A colour per level for `org-chart-build`: the accent, then the accents two
 * and four steps away in the vocabulary — a ramp that stays inside the shared
 * palette instead of inventing colours. The block reuses the last entry for
 * any deeper level, so three rungs cover every chart the schema allows.
 */
export function levelColorsFor(
  accent: Accent | null | undefined,
): string[] | undefined {
  if (accent == null) return undefined;

  const start = ACCENT_ORDER.indexOf(accent);
  return [0, 2, 4].map(
    (step) => ACCENT_HEX[ACCENT_ORDER[(start + step) % ACCENT_ORDER.length]],
  );
}

/**
 * How much faster than its own tempo a block has to run so that its last beat
 * lands at ~85% of the scene and the rest holds — the migration plan's
 * cross-cutting rule:
 *
 *     speed = clamp(nominal / (0.85 * fittedSeconds), 0.4, 3)
 *
 * It takes the scene rather than the plan's `(kind, fittedSeconds)` sketch
 * because `nominal` moves with the scene's own counts inside a kind (more
 * points, more code lines, a longer paragraph) — the things a caller of the
 * literal signature would have had to pass along anyway.
 *
 * The worker replaces `durationSeconds` with the narration-fitted length
 * before the composition sees it, so the field already holds what this rule
 * wants. Studio's default scene is not fitted and simply runs slow.
 */
export function speedFor(scene: Scene): number {
  const fittedSeconds = scene.durationSeconds;
  return clamp(nominalSeconds(scene) / (0.85 * fittedSeconds), 0.4, 3);
}

/**
 * Seconds from a block's first beat to its last, at speed 1, measured from
 * each block's own beat plan. Only the beat that can be the *last* one counts;
 * entrances that always land earlier are left out. Each formula names the
 * block constants it mirrors, so a `remotion-ui update` that moves them is a
 * one-line fix here.
 */
export function nominalSeconds(scene: Scene): number {
  switch (scene.kind) {
    case 'title':
      // title-card: the sweep across the headline (T.sweep + T.sweepFor).
      return 0.95 + 1.25;

    case 'points':
      // feature-list: the closing rule, drawn over 0.45s once the last row
      // lands (T.rows + n*T.rowStagger + 0.45).
      return 0.55 + scene.items.length * 0.34 + 0.45;

    case 'flow': {
      // data-flow-pipes: the last packet's last hop, then the node it landed
      // on staying lit (T.firstPacket + (packets-1)*T.emit + (stages-1)*T.hop
      // + T.pulse).
      const packets = scene.packets ?? FLOW_DEFAULT_PACKETS;
      return 1.15 + (packets - 1) * 0.26 + (scene.stages.length - 1) * 0.52 + 0.5;
    }

    case 'topology':
      return topologyNominal(scene);

    case 'sequence':
      // timeline-steps: the last step's check (T.start + (n-1)*(T.dwell +
      // T.travel) + T.dwell).
      return 0.5 + (scene.steps.length - 1) * 1.2 + 0.78;

    case 'code':
      return codeNominal(scene);

    case 'concept':
      // The concept scene's own beat plan, from its shared timeline.
      return conceptTimeline(scene).total;

    default: {
      const unhandled: never = scene;
      throw new Error(`No nominal length rule for ${String(unhandled)}`);
    }
  }
}

/** The block's own packet count when the storyboard does not name one. */
const FLOW_DEFAULT_PACKETS = 9;

/**
 * org-chart-build lands node i at `startAtSeconds + depth*levelStaggerSeconds
 * + orderInLevel*siblingStaggerSeconds`, then springs it in. `orderInLevel`
 * comes out of the block's leaf walk, which is not worth reproducing here, so
 * this takes the upper bound instead: any node could be last inside its level.
 * Overestimating the nominal only makes the chart run a touch fast and hold
 * its finished state — the safe direction.
 */
function topologyNominal(scene: TopologyScene): number {
  const parents = scene.nodes.map((node) => node.parent ?? null);

  const depths = parents.map((_, index) => {
    let depth = 0;
    let cursor = parents[index];
    // Validation puts every parent before its children, so this walks down
    // naturally; the step bound is what keeps a hand-edited cycle from
    // spinning (the block guards its own walk the same way).
    for (let steps = 0; cursor !== null && steps < parents.length; steps += 1) {
      depth += 1;
      cursor = parents[cursor] ?? null;
    }
    return depth;
  });

  const lastLanding = scene.nodes.reduce((latest, _node, index) => {
    const depth = depths[index];
    const atDepth = depths.filter((other) => other === depth).length;
    return Math.max(latest, depth * 0.62 + (atDepth - 1) * 0.12);
  }, 0);

  // startAtSeconds (0.34) + last landing + the node's spring settling (~0.55).
  return 0.34 + lastLanding + 0.55;
}

/* Mirrors of code-reveal's write plan, so the nominal and the animation agree. */
const CODE_WRITE_CPS = 55;
const CODE_NEWLINE_PAUSE = 0.07;
const CODE_WRITE_START = 0.4;
/** writeEnd -> the focus sweep over the highlighted lines (focusAt + 0.5s). */
const CODE_FOCUS_TAIL = 0.34 + 0.5;
/** writeEnd -> the header's unsaved dot settling when nothing is focused. */
const CODE_SETTLE_TAIL = 0.4;

function codeNominal(scene: CodeScene): number {
  // The block trims the listing exactly this way before planning lines, and
  // only charges for the characters a person would type — indentation is free.
  const lines = scene.code.replace(/\s+$/, '').replace(/^\n+/, '').split('\n');
  const typed = lines.reduce(
    (seconds, line) => seconds + line.trimStart().length / CODE_WRITE_CPS,
    0,
  );
  const newlines = Math.max(0, lines.length - 1) * CODE_NEWLINE_PAUSE;

  return (
    CODE_WRITE_START +
    typed +
    newlines +
    (scene.highlightedLines.length > 0 ? CODE_FOCUS_TAIL : CODE_SETTLE_TAIL)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Accent, theme and speed, resolved the same way for every block. */
function shared(scene: Scene) {
  return {
    accentColor: accentHex(scene.accent),
    theme: themeFor(scene.theme),
    speed: speedFor(scene),
  };
}

export function titleCardProps(scene: TitleScene): TitleCardProps {
  return {
    title: scene.title,
    subtitle: scene.subtitle ?? undefined,
    eyebrow: scene.eyebrow ?? undefined,
    meta: scene.meta ?? undefined,
    ...shared(scene),
  };
}

export function featureListProps(scene: PointsScene): FeatureListProps {
  return {
    title: scene.title,
    eyebrow: scene.eyebrow ?? undefined,
    items: scene.items.map((item) => ({
      label: item.label,
      detail: item.detail ?? undefined,
    })),
    ...shared(scene),
  };
}

export function dataFlowPipesProps(scene: FlowScene): DataFlowPipesProps {
  return {
    stages: scene.stages.map((stage) => ({
      label: stage.label,
      detail: stage.detail ?? undefined,
    })),
    // A bare tally needs no noun: an unlabelled count beats borrowing the
    // block's demo word for it.
    unit: scene.unit ?? '',
    packets: scene.packets ?? FLOW_DEFAULT_PACKETS,
    ...shared(scene),
  };
}

export function orgChartProps(scene: TopologyScene): OrgChartBuildProps {
  return {
    title: scene.title,
    nodes: scene.nodes.map((node) => ({
      name: node.name,
      role: node.role ?? undefined,
      // `undefined` is the block's root marker. A null leaking through would
      // read as a real parent index and put NaN in the connector geometry.
      parent: node.parent ?? undefined,
    })),
    // undefined keeps the block's own level ramp.
    levelColors: levelColorsFor(scene.accent),
    ...shared(scene),
  };
}

export function timelineStepsProps(scene: SequenceScene): TimelineStepsProps {
  return {
    steps: scene.steps.map((step) => ({
      title: step.title,
      description: step.description ?? undefined,
    })),
    title: scene.title,
    eyebrow: scene.eyebrow ?? undefined,
    ...shared(scene),
  };
}

export function codeRevealProps(scene: CodeScene): CodeRevealProps {
  return {
    code: scene.code,
    highlightedLines: scene.highlightedLines,
    // The block only *displays* these two in the editor chrome — its tokenizer
    // is language-agnostic — so the storyboard's own words pass straight
    // through. Empty strings leave the chrome unlabelled rather than putting a
    // filename or language the storyboard never claimed on screen.
    title: scene.filename ?? '',
    language: scene.language ?? '',
    startLine: scene.startLine ?? undefined,
    ...shared(scene),
  };
}

export function conceptSceneProps(scene: ConceptScene): ConceptProps {
  return {
    title: scene.title,
    eyebrow: scene.eyebrow ?? undefined,
    explanation: scene.explanation,
    terms: scene.terms,
    keyPoints: scene.keyPoints,
    takeaway: scene.takeaway,
    ...shared(scene),
  };
}
