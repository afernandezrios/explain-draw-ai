/**
 * The kit's public surface, one line per layer.
 *
 * A barrel is the right shape here because the kit is a *library*: what it
 * exports is the contract, and a consumer writing a new scene should be able to
 * see the whole vocabulary in one screen. Everything below the scenes is
 * exported on purpose -- the six scene types cover the common pictures, and the
 * primitives and geometry are what a seventh is built from.
 *
 * Imports from outside the kit go through this file (`from '../kit/index.ts'`),
 * so a module can be moved between layers without touching its callers.
 */

// The design language: colours, type, spacing, motion.
export {
  ACCENTS,
  CANVAS,
  DARK,
  FONT,
  LAYOUT,
  LIGHT,
  MOTION,
  RADIUS,
  SPACE,
  THEMES,
  TONES,
  TYPE,
  alpha,
  frameContentBox,
  mix,
  toneAccent,
} from './tokens.ts';
export type { Accent, TextVariant, Theme, ThemeName, Tone } from './tokens.ts';

// Which theme a scene is drawn in, and the hooks that read it.
export { KitTheme, resolveTheme, useTheme } from './theme.tsx';
export type { ThemeProp } from './theme.tsx';
export { useKitFonts } from './fonts.ts';

// The scene shell and the box a scene body lays out in.
export { Frame, FrameCaption, useFrameBox } from './layout/Frame.tsx';
export type { FrameBox, FrameProps } from './layout/Frame.tsx';
export { Center, Column, Grid, Row } from './layout/Stack.tsx';
export type { ColumnProps, GridProps, RowProps } from './layout/Stack.tsx';

// Primitives.
export { AccentRule, Text } from './primitives/Text.tsx';
export type { TextProps, TextTone } from './primitives/Text.tsx';
export { Surface } from './primitives/Surface.tsx';
export type { SurfaceProps } from './primitives/Surface.tsx';
export { Pill } from './primitives/Pill.tsx';
export type { PillProps } from './primitives/Pill.tsx';
export { ICON_NAMES, Icon } from './primitives/Icon.tsx';
export type { IconName, IconProps } from './primitives/Icon.tsx';
export {
  DiagramNode,
  NODE_DEFAULT_HEIGHT,
  NODE_DEFAULT_WIDTH,
  NODE_STACK_MIN_HEIGHT,
} from './primitives/DiagramNode.tsx';
export type { DiagramNodeProps } from './primitives/DiagramNode.tsx';
export { Edge, EdgeLayer } from './primitives/Edge.tsx';
export type { EdgeLayerProps, EdgeProps } from './primitives/Edge.tsx';
export { CodeBlock, DEFAULT_CODE_FONT_SIZE } from './primitives/CodeBlock.tsx';
export type { CodeBlockProps } from './primitives/CodeBlock.tsx';
export { Callout } from './primitives/Callout.tsx';
export type { CalloutProps } from './primitives/Callout.tsx';

// The markup primitives: the hand-authored layer, one level below the scenes.
export { Box } from './primitives/Box.tsx';
export type { BoxProps } from './primitives/Box.tsx';
export { Label } from './primitives/Label.tsx';
export type { LabelAnchor, LabelProps } from './primitives/Label.tsx';
export { Highlight } from './primitives/Highlight.tsx';
export type { HighlightProps, HighlightVariant } from './primitives/Highlight.tsx';
export { Arrow } from './primitives/Arrow.tsx';
export type { ArrowProps } from './primitives/Arrow.tsx';
export { Connection } from './primitives/Connection.tsx';
export type { ConnectionAnchor, ConnectionProps } from './primitives/Connection.tsx';
export { Node } from './primitives/Node.tsx';
export type { NodeProps } from './primitives/Node.tsx';
export { MOTIF_VARIANTS, Motif } from './primitives/Motif.tsx';
export type { MotifProps, MotifVariant } from './primitives/Motif.tsx';

// Animation: when things happen, and how they arrive.
export { Reveal } from './animation/Reveal.tsx';
export type { RevealProps } from './animation/Reveal.tsx';
export { REVEAL_PRESETS, easeBetween, ramp, revealStyle } from './animation/presets.ts';
export type { RevealPreset } from './animation/presets.ts';
export { loopProgress, paceReveals, staggerTimings, toFrames } from './animation/timing.ts';
export type { PaceOptions, ScenePace, Timing } from './animation/timing.ts';
export { useEnterProgress, useEnterStyle } from './animation/useEnter.ts';

// Maths, kept out of React so a diagram can be reasoned about without drawing.
export {
  bendControl,
  borderPoint,
  centerOf,
  pathBetween,
  pointAlong,
  pointOnEdge,
  polylineLength,
  rectFromCenter,
  roundedRectPath,
  segmentBetween,
  selfLoopPath,
} from './lib/geometry.ts';
export type { Point, Rect } from './lib/geometry.ts';
export { depthByNode } from './lib/graph.ts';
export type { GraphEdge } from './lib/graph.ts';
export { LANGUAGES, LANGUAGE_LABEL, tokenize, tokenizeLine } from './lib/highlight.ts';
export type { Language, Token, TokenKind } from './lib/highlight.ts';
export { ADVANCE, estimatedLineCount, fitFontSize } from './lib/fit.ts';
export type { FitOptions } from './lib/fit.ts';

// The scene types.
export { TitleScene } from './scenes/TitleScene.tsx';
export type { TitleSceneProps } from './scenes/TitleScene.tsx';
export { PointsScene } from './scenes/PointsScene.tsx';
export type { PointItem, PointsSceneProps } from './scenes/PointsScene.tsx';
export { FlowScene } from './scenes/FlowScene.tsx';
export type { FlowSceneProps, FlowStep } from './scenes/FlowScene.tsx';
export { TopologyScene } from './scenes/TopologyScene.tsx';
export type { TopologyEdge, TopologyNode, TopologySceneProps } from './scenes/TopologyScene.tsx';
export { SequenceScene } from './scenes/SequenceScene.tsx';
export type { SequenceActor, SequenceMessage, SequenceSceneProps } from './scenes/SequenceScene.tsx';
export { CodeScene } from './scenes/CodeScene.tsx';
export type { CodeAside, CodeSceneProps } from './scenes/CodeScene.tsx';

// The kit's own compositions, registered by `RemotionRoot`.
export { KitRoot } from './KitRoot.tsx';
export { PrimitivesGallery } from './PrimitivesGallery.tsx';
