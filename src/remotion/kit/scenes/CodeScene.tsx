/**
 * The code scene: the listing, and the thing to notice about it.
 *
 * A listing is the one thing in this kit that cannot be scaled to fit: a line
 * of code has a minimum readable size, so rather than shrinking the type this
 * scene sizes the type from the *line count* and lets a long listing be a hint
 * that the scene should have been two.
 *
 * `progressive` is the difference between showing a file and narrating it. On,
 * lines arrive one per beat and the newest one flashes; off, the whole listing
 * is simply there from the first frame, which is what a scene that is being
 * talked *around* -- pointing at line 12, comparing two halves -- wants.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { MOTION, SPACE, type Accent, type Tone } from '../tokens.ts';
import type { ThemeProp } from '../theme.tsx';
import { Frame, FrameCaption, useFrameBox } from '../layout/Frame.tsx';
import { Row } from '../layout/Stack.tsx';
import { Callout } from '../primitives/Callout.tsx';
import { CodeBlock, DEFAULT_CODE_FONT_SIZE } from '../primitives/CodeBlock.tsx';
import type { IconName } from '../primitives/Icon.tsx';
import type { Language } from '../lib/highlight.ts';
import { revealStyle } from '../animation/presets.ts';
import { paceReveals, toFrames, type ScenePace, type Timing } from '../animation/timing.ts';

/** The window bar and the panel's own vertical padding, in pixels. */
const CHROME_HEIGHT = 92;
const PANEL_PADDING = 44;
/** `TYPE.code`'s line height, as a multiplier -- the fit maths needs a number. */
const LINE_HEIGHT = 1.62;
/** Below this a listing is unreadable at 1080p; the scene lets it overflow
 * instead, which is the visible symptom of too much code. */
const MIN_FONT_SIZE = 15;

export type CodeAside = {
  title: string;
  body?: string;
  points?: string[];
  icon?: IconName;
  /** Defaults to `info`. `warn` and `danger` are what the eye catches first. */
  tone?: Tone;
};

export type CodeSceneProps = {
  title: string;
  eyebrow?: string;
  code: string;
  language?: Language;
  /** What the window's title bar says. A filename, a route, a topic. */
  filename?: string;
  startLine?: number;
  /** 1-based lines kept emphasised for the whole scene. */
  highlight?: number[];
  /** Reveal the listing one line at a time. */
  progressive?: boolean;
  /** A note beside the listing, for what the code does not say. */
  aside?: CodeAside;
  /** A line in the footer, usually the sentence the narration ends on. */
  caption?: string;
  /** Overrides the default one-beat-per-line pacing. See `ScenePace`. */
  pace?: ScenePace;
  accent?: Accent;
  theme?: ThemeProp;
};

export const CodeScene: React.FC<CodeSceneProps> = ({
  title,
  eyebrow,
  code,
  language = 'ts',
  filename,
  startLine = 1,
  highlight,
  progressive = false,
  aside,
  caption,
  pace,
  accent = 'blue',
  theme,
}) => (
  <Frame
    name="Code scene"
    eyebrow={eyebrow}
    title={title}
    accent={accent}
    theme={theme}
    footer={caption === undefined ? undefined : <FrameCaption accent={accent}>{caption}</FrameCaption>}
  >
    <CodeBody
      code={code}
      language={language}
      filename={filename}
      startLine={startLine}
      highlight={highlight}
      progressive={progressive}
      aside={aside}
      pace={pace}
      accent={accent}
    />
  </Frame>
);

const CodeBody: React.FC<
  Pick<
    CodeSceneProps,
    'code' | 'language' | 'filename' | 'startLine' | 'highlight' | 'progressive' | 'aside' | 'pace'
  > & { accent: Accent }
> = ({
  code,
  language = 'ts',
  filename,
  startLine = 1,
  highlight,
  progressive,
  aside,
  pace,
  accent,
}) => {
  const box = useFrameBox();
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const lineCount = Math.max(1, code.split('\n').length);
  const fontSize = clamp(
    (box.height - CHROME_HEIGHT - PANEL_PADDING) / lineCount / LINE_HEIGHT,
    MIN_FONT_SIZE,
    DEFAULT_CODE_FONT_SIZE,
  );
  // One beat per line, starting a little later than a diagram's lead-in so the
  // header has settled before the first line lands.
  const reveals: Timing[] | undefined = progressive
    ? paceReveals(lineCount, { fps, durationInFrames, leadSeconds: 0.6, ...pace })
    : undefined;
  const asideBeat: Timing =
    reveals?.[0] ?? { delay: 0, duration: toFrames(MOTION.enterSeconds, fps) };

  return (
    <Row gap={SPACE.xxl} align="center" style={{ height: '100%' }}>
      <CodeBlock
        code={code}
        language={language}
        title={filename}
        startLine={startLine}
        highlight={highlight}
        reveals={reveals}
        fontSize={fontSize}
        accent={accent}
        style={{ flex: 1, minWidth: 0 }}
      />
      {aside === undefined ? null : (
        <Callout
          title={aside.title}
          body={aside.body}
          points={aside.points}
          icon={aside.icon}
          tone={aside.tone ?? 'info'}
          // A panel beside the listing, not a caption under it. It waits for
          // the first line of code when the listing is progressive, and for the
          // scene's own lead-in when it is not.
          style={{
            width: 520,
            flexShrink: 0,
            ...revealStyle('fade', frame, asideBeat),
          }}
        />
      )}
    </Row>
  );
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
