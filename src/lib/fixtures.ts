/**
 * Canned script and storyboard.
 *
 * Two consumers, both of them test scaffolding: `FakeLlm` in llm.ts answers
 * with these when a test does not pass its own, and the e2e suite builds its
 * projects and renders from them.
 *
 * Three ten-second scenes -- a title, a list and a pipeline -- a ~30 second
 * storyboard the tests can actually render end to end in minutes.
 */

import type { Scene } from '../scenes/schema.ts';
import type { Script } from '../script/types.ts';

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
    kind: 'title',
    title: 'How a Cache Works',
    durationSeconds: 10,
    subtitle: 'A small, fast copy kept close by',
    eyebrow: 'Explain it simply',
    meta: null,
    theme: 'dark',
    accent: 'blue',
    narration: 'A cache keeps a small, fast copy of the data you ask for again and again.',
  };

  const problem: Scene = {
    kind: 'points',
    title: 'Why it helps',
    durationSeconds: 10,
    eyebrow: null,
    accent: 'green',
    items: [
      { label: 'The disk is slow', detail: 'Every read costs time' },
      { label: 'Requests repeat', detail: 'The same data, over and over' },
      { label: 'Users wait', detail: null },
    ],
    narration: 'The disk is slow, requests repeat, and users wait, so we keep the answer close.',
  };

  const fix: Scene = {
    kind: 'flow',
    title: 'The read path',
    durationSeconds: 10,
    unit: 'reads',
    packets: 6,
    accent: 'cyan',
    stages: [
      { label: 'Ask', detail: 'the request' },
      { label: 'Check', detail: 'the fast copy' },
      { label: 'Serve', detail: null },
    ],
    narration: 'A request is checked against the fast copy, and served from it when it is there.',
  };

  return [title, problem, fix];
}
