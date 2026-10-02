/**
 * The opening card: what this is, and what it is about.
 *
 * It draws no header of its own -- the title *is* the scene -- so it takes the
 * whole content box and centres in it. Everything after the title is optional,
 * which is what lets the same component open a series, a chapter and a
 * five-minute explainer without three variants.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { Accent } from '../tokens.ts';
import type { ThemeProp } from '../theme.tsx';
import { Frame, FrameCaption } from '../layout/Frame.tsx';
import { Column, Row } from '../layout/Stack.tsx';
import { AccentRule, Text } from '../primitives/Text.tsx';
import { Pill } from '../primitives/Pill.tsx';
import { Reveal } from '../animation/Reveal.tsx';
import { revealStyle } from '../animation/presets.ts';
import { paceReveals, type ScenePace } from '../animation/timing.ts';

export type TitleSceneProps = {
  title: string;
  subtitle?: string;
  /** The line above the title: a chapter, a series, a number. */
  eyebrow?: string;
  /** Short labels under the title: protocols, technologies, the nouns in play. */
  tags?: string[];
  /** A closing line in the footer, usually the series or the next section. */
  footnote?: string;
  /** Overrides the default entrance pacing. See `ScenePace`. */
  pace?: ScenePace;
  accent?: Accent;
  theme?: ThemeProp;
};

export const TitleScene: React.FC<TitleSceneProps> = ({
  title,
  subtitle,
  eyebrow,
  tags,
  footnote,
  pace,
  accent = 'blue',
  theme,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const hasEyebrow = eyebrow !== undefined;
  const hasSubtitle = subtitle !== undefined;
  const tagList = tags ?? [];
  // One beat per element that exists, so a card without an eyebrow does not
  // leave a hole in the pacing where one would have been.
  const beats = paceReveals((hasEyebrow ? 1 : 0) + 1 + (hasSubtitle ? 1 : 0) + tagList.length, {
    fps,
    durationInFrames,
    ...pace,
  });
  let cursor = 0;
  const eyebrowBeat = hasEyebrow ? beats[cursor++] : null;
  const titleBeat = beats[cursor++];
  const subtitleBeat = hasSubtitle ? beats[cursor++] : null;
  const tagBeats = beats.slice(cursor);

  return (
    <Frame
      name="Title scene"
      accent={accent}
      theme={theme}
      footer={footnote === undefined ? undefined : <FrameCaption accent={accent}>{footnote}</FrameCaption>}
    >
      <Column justify="center" style={{ height: '100%', gap: 0, maxWidth: 1560 }}>
        {eyebrow === undefined || eyebrowBeat === null ? null : (
          <Row gap={16} style={revealStyle('slideRight', frame, eyebrowBeat, 14)}>
            <AccentRule progress={1} width={38} accent={accent} thickness={4} />
            <Text variant="label" tone="secondary">
              {eyebrow}
            </Text>
          </Row>
        )}

        <Text
          variant="display"
          style={{ marginTop: hasEyebrow ? 30 : 0, ...revealStyle('rise', frame, titleBeat, 36) }}
        >
          {title}
        </Text>

        {subtitle === undefined || subtitleBeat === null ? null : (
          <Text
            variant="subheading"
            tone="secondary"
            style={{ marginTop: 28, maxWidth: 1320, ...revealStyle('rise', frame, subtitleBeat, 28) }}
          >
            {subtitle}
          </Text>
        )}

        {tagList.length === 0 ? null : (
          <Row gap={14} wrap style={{ marginTop: 48 }}>
            {tagList.map((tag, index) => (
              <Reveal
                key={tag}
                preset="pop"
                delay={tagBeats[index].delay}
                duration={tagBeats[index].duration}
              >
                <Pill mono accent={accent}>
                  {tag}
                </Pill>
              </Reveal>
            ))}
          </Row>
        )}
      </Column>
    </Frame>
  );
};
