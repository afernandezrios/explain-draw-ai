import { Audio } from '@remotion/media';
import React from 'react';
import { AbsoluteFill, staticFile } from 'remotion';
import type { Scene as SceneData } from '../lib/schema.ts';

export type SceneProps = {
  scene: SceneData;
  sceneIndex: number;
  totalScenes: number;
  /**
   * This scene's narration WAV, as a path relative to the bundle's public
   * directory (`staticFile` resolves it), or null when the scene has none --
   * which is only Remotion Studio's default props: a render always passes the
   * worker's synthesized file.
   */
  narrationPath: string | null;
};

/**
 * TEMPORARY BRIDGE (Stage 1 of the RemotionUI migration).
 *
 * The stroke-by-stroke SVG drawing is gone, and the RemotionUI blocks that
 * replace it land in Stage 2. Until then a scene is an empty fill that still
 * carries its narration, so the audio contract -- one WAV per scene, starting
 * at the composition's first frame -- keeps being exercised by real renders.
 * The props are the real ones; only the picture is missing.
 */
export const Scene: React.FC<SceneProps> = ({ narrationPath }) => {
  return (
    <>
      {narrationPath === null ? null : <Audio src={staticFile(narrationPath)} />}
      <AbsoluteFill />
    </>
  );
};
