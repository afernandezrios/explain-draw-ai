import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { PAPER } from '../lib/board.ts';
import type { Scene as SceneData } from '../lib/schema.ts';
import { sceneSvg } from '../lib/svg.ts';
import { drawWindows } from '../lib/timeline.ts';

export type SceneProps = {
  scene: SceneData;
  sceneIndex: number;
  totalScenes: number;
};

/**
 * One scene, drawn stroke by stroke.
 *
 * Every frame builds the same SVG the preview uses, with each shape's draw
 * progress eased from its own slot in the timeline. Shapes whose window has not
 * opened yet are fully dash-offset, so they are invisible rather than missing.
 */
export const Scene: React.FC<SceneProps> = ({ scene }) => {
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

  const svg = useMemo(() => sceneSvg(scene, progress, { width: '100%', height: '100%' }), [scene, progress]);

  return <AbsoluteFill style={{ backgroundColor: PAPER }} dangerouslySetInnerHTML={{ __html: svg }} />;
};
