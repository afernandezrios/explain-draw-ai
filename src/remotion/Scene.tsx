import { Audio } from '@remotion/media';
import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { PAPER } from '../lib/board.ts';
import type { Scene as SceneData } from '../lib/schema.ts';
import { sceneSvg } from '../lib/svg.ts';
import { drawWindows } from '../lib/timeline.ts';

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
 * One scene, drawn stroke by stroke, with its narration as the clip's audio.
 *
 * Every frame builds the same SVG the preview uses, with each shape's draw
 * progress eased from its own slot in the timeline. Shapes whose window has not
 * opened yet are fully dash-offset, so they are invisible rather than missing.
 *
 * The audio starts at the composition's first frame, so a scene's narration
 * begins exactly when its scene begins -- in a preview clip and in the joined
 * video alike, because the join passes this track through untouched.
 */
export const Scene: React.FC<SceneProps> = ({ scene, sceneIndex, totalScenes, narrationPath }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const windows = useMemo(
    () => drawWindows(scene.shapes.length, durationInFrames),
    [scene.shapes.length, durationInFrames],
  );

  const progress = useMemo(
    () =>
      windows.map((window) =>
        interpolate(frame, [window.start, window.end], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.out(Easing.cubic),
        }),
      ),
    [frame, windows],
  );

  const svg = useMemo(
    () => sceneSvg(scene, progress, { width: '100%', height: '100%', sceneIndex, totalScenes }),
    [scene, progress, sceneIndex, totalScenes],
  );

  return (
    <>
      {narrationPath === null ? null : <Audio src={staticFile(narrationPath)} />}
      <AbsoluteFill style={{ backgroundColor: PAPER }} dangerouslySetInnerHTML={{ __html: svg }} />
    </>
  );
};
