/**
 * Canned script and storyboard.
 *
 * Two consumers, both of them test scaffolding: `FakeLlm` in llm.ts answers
 * with these when a test does not pass its own, and the e2e suite builds its
 * projects and renders from them.
 *
 * Three ten-second scenes: a ~30 second storyboard the tests can actually
 * render end to end in minutes.
 */

import type { Scene } from './schema.ts';
import type { Script } from './types.ts';

export const FAKE_SCRIPT: Script = {
  title: 'How a Cache Works',
  text: [
    '# How a Cache Works',
    '',
    '## The problem',
    'A computer asks for the same data again and again, and the disk is slow.',
    '',
    '## The fix',
    'Keep a small, fast copy close by and hand that back instead.',
    '',
    '## The trade',
    'The copy can go stale, so it needs a rule for when to throw it away.',
  ].join('\n'),
};

export function fakeScenes(): Scene[] {
  const title: Scene = {
    title: 'Title card',
    durationSeconds: 10,
    shapes: [
      { kind: 'label', x: 8, y: 30, text: 'How a Cache Works', size: 11, color: null },
      { kind: 'underline', x: 8, y: 35, w: 52, color: 'accent' },
      { kind: 'stickFigure', x: 84, y: 52, height: 46, color: null },
      { kind: 'cloud', x: 58, y: 24, w: 22, h: 26, color: 'accent' },
    ],
  };

  const problem: Scene = {
    title: 'The problem',
    durationSeconds: 10,
    shapes: [
      { kind: 'box', x: 8, y: 34, w: 26, h: 30, color: null },
      { kind: 'label', x: 10, y: 44, text: 'slow disk', size: 7, color: null },
      { kind: 'arrow', from: { x: 36, y: 49 }, to: { x: 60, y: 49 }, color: null },
      { kind: 'circle', x: 76, y: 49, r: 13, color: 'emphasis' },
      { kind: 'label', x: 66, y: 30, text: 'asks again', size: 7, color: 'emphasis' },
    ],
  };

  const fix: Scene = {
    title: 'The fix',
    durationSeconds: 10,
    shapes: [
      { kind: 'cloud', x: 62, y: 32, w: 26, h: 30, color: null },
      { kind: 'label', x: 52, y: 26, text: 'keep a copy', size: 7, color: null },
      { kind: 'connector', from: { x: 38, y: 60 }, to: { x: 56, y: 44 }, color: null },
      { kind: 'circle', x: 20, y: 62, r: 14, color: 'accent' },
      { kind: 'label', x: 10, y: 80, text: 'fast', size: 8, color: 'accent' },
    ],
  };

  return [title, problem, fix];
}
