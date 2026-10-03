import { Audio } from '@remotion/media';
import React from 'react';
import { AbsoluteFill, staticFile } from 'remotion';
import type { Scene as SceneData } from '../lib/schema.ts';
import {
  codeRevealProps,
  conceptSceneProps,
  dataFlowPipesProps,
  diagramSceneProps,
  featureListProps,
  orgChartProps,
  timelineStepsProps,
  titleCardProps,
} from './scene-adapters.tsx';
import { CodeReveal } from '@/remotion/scenes/code-reveal';
import { ConceptScene } from '@/remotion/scenes/concept';
import { DataFlowPipes } from '@/remotion/scenes/data-flow-pipes';
import { Diagram } from '@/remotion/scenes/diagram';
import { FeatureList } from '@/remotion/scenes/feature-list';
import { OrgChartBuild } from '@/remotion/scenes/org-chart-build';
import { TimelineSteps } from '@/remotion/scenes/timeline-steps';
import { TitleCard } from '@/remotion/scenes/title-card';

export type SceneProps = {
  scene: SceneData;
  sceneIndex: number;
  totalScenes: number;
  narrationPath: string | null;
};

/**
 * One scene of any kind, on the blocks. The storyboard reaching this point has
 * been laid out and validated (every read path runs structure -> layout ->
 * validation), so all that is left is the translation into block props -- see
 * `./scene-adapters.tsx` -- and the mount. The blocks own the frame: each fills
 * the canvas itself and draws no shared chrome.
 */
const SceneByKind: React.FC<{ scene: SceneData }> = ({ scene }) => {
  switch (scene.kind) {
    case 'title':
      return <TitleCard {...titleCardProps(scene)} />;
    case 'points':
      return <FeatureList {...featureListProps(scene)} />;
    case 'flow':
      return <DataFlowPipes {...dataFlowPipesProps(scene)} />;
    case 'topology':
      return <OrgChartBuild {...orgChartProps(scene)} />;
    case 'diagram':
      return <Diagram {...diagramSceneProps(scene)} />;
    case 'sequence':
      return <TimelineSteps {...timelineStepsProps(scene)} />;
    case 'code':
      return <CodeReveal {...codeRevealProps(scene)} />;
    case 'concept':
      return <ConceptScene {...conceptSceneProps(scene)} />;
    default: {
      const unhandled: never = scene;
      throw new Error(`No block for scene kind ${String(unhandled)}`);
    }
  }
};

/**
 * The composition's entry point. The narration contract is unchanged from the
 * SVG renderer: the worker synthesizes one WAV per scene and hands over its
 * static-file path, and the audio is baked into the scene's own clip here.
 */
export const Scene: React.FC<SceneProps> = ({ scene, narrationPath }) => (
  <AbsoluteFill>
    <SceneByKind scene={scene} />
    {narrationPath === null ? null : <Audio src={staticFile(narrationPath)} />}
  </AbsoluteFill>
);
