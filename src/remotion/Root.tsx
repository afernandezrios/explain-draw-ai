import React from 'react';
import { Composition, type CalculateMetadataFunction } from 'remotion';
import { CANVAS_HEIGHT, CANVAS_WIDTH, FPS, secondsToFrames } from '../lib/render-config.ts';
import type { Scene as SceneData } from '../lib/schema.ts';
import { Scene, type SceneProps } from './Scene.tsx';
import { KitRoot } from './kit/KitRoot.tsx';

/**
 * The default storyboard is only what Remotion Studio opens with. Real renders
 * pass the project's own scene through `inputProps`, which is why the
 * composition is parameterised rather than one composition per scene. Studio has
 * no project behind it, so its scene carries no narration -- a real render
 * always names the WAV the worker synthesized.
 */
const DEFAULT_SCENE: SceneData = {
  kind: 'title',
  title: 'Studio default',
  durationSeconds: 10,
  theme: 'dark',
  accent: 'blue',
  subtitle: 'Explain it by drawing it',
  eyebrow: 'Remotion Studio',
  meta: null,
  // Every scene carries one, so the studio's own scene has to as well.
  narration: 'Every idea gets clearer when you draw it out, one stroke at a time.',
};

/** Each scene knows its own length, so the composition asks it per render. */
const calculateSceneMetadata: CalculateMetadataFunction<SceneProps> = ({ props }) => {
  return {
    durationInFrames: secondsToFrames(props.scene.durationSeconds),
    fps: FPS,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  };
};

/**
 * One composition, parameterised by the scene in its input props -- plus the
 * component kit's own demos, which the render pipeline never mounts. They are
 * here rather than in a Studio-only entry point so that the kit is visible
 * wherever the project is previewed; they cost a few component definitions and
 * nothing at render time.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Scene"
        component={Scene}
        durationInFrames={secondsToFrames(DEFAULT_SCENE.durationSeconds)}
        fps={FPS}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        defaultProps={{ scene: DEFAULT_SCENE, sceneIndex: 0, totalScenes: 1, narrationPath: null }}
        calculateMetadata={calculateSceneMetadata}
      />
      <KitRoot />
    </>
  );
};
