/**
 * The opening card: what this is, and what it is about.
 *
 * It draws no header of its own -- the title *is* the scene -- so it takes the
 * whole content box and centres in it. Everything after the title is optional,
 * which is what lets the same component open a series, a chapter and a
 * five-minute explainer without three variants.
 *
 * The card is a column of type against a structure: the words on the left, the
 * motif bleeding off the right. That split is why the column is not centred --
 * a centred title would sit *on* the motif, and the one thing a background
 * element may never do is get between a viewer and the sentence they are
 * reading. The column's width and the motif's placement are set together for
 * that reason; moving one means moving the other.
 *
 * The title is sized to its own copy. A card is the one scene whose text is not
 * written for its box, so `fitFontSize` shrinks a long title until it fits its
 * lines rather than letting it run off the canvas -- see `lib/fit.ts`.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { TYPE, type Accent } from '../tokens.ts';
import type { ThemeProp } from '../theme.tsx';
import { Frame, FrameCaption } from '../layout/Frame.tsx';
import { Column, Row } from '../layout/Stack.tsx';
import { AccentRule, Text } from '../primitives/Text.tsx';
import { Pill } from '../primitives/Pill.tsx';
import { Motif, type MotifVariant } from '../primitives/Motif.tsx';
import { Reveal } from '../animation/Reveal.tsx';
import { revealStyle } from '../animation/presets.ts';
import { paceReveals, type ScenePace } from '../animation/timing.ts';
import { ADVANCE, fitFontSize } from '../lib/fit.ts';

/**
 * The column's box, in canvas pixels. Narrower than the content box so the
 * motif has a margin of its own: text may reach 1260, the motif starts at 1384.
 */
const TITLE_BOX = { width: 1260, maxLines: 3, minSize: 76 } as const;
const SUBTITLE_BOX = { width: 1080, maxLines: 3, minSize: 26 } as const;

export type TitleSceneProps = {
  title: string;
  subtitle?: string;
  /** The line above the title: a chapter, a series, a number. */
  eyebrow?: string;
  /** A short label in the accent colour, beside the eyebrow: "Deep dive",
   * "Part 3". Where `eyebrow` is the context, this is the stamp. */
  accentLabel?: string;
  /** Short labels under the title: protocols, technologies, the nouns in play. */
  tags?: string[];
  /** A closing line in the footer, usually the series or the next section. */
  footnote?: string;
  /** The faint structure behind the card. `none` for a bare canvas. */
  motif?: MotifVariant | 'none';
  /**
   * The length the Studio registration gives this composition, in seconds.
   * The component ignores it: a scene is *told* how long it is, and in a render
   * that length is the narration's measured one. It is here because the demo
   * is registered from this object and a title card is worth previewing at a
   * few lengths -- `KitRoot.tsx` reads it through `calculateMetadata`.
   */
  durationSeconds?: number;
  /** Overrides the default entrance pacing. See `ScenePace`. */
  pace?: ScenePace;
  accent?: Accent;
  theme?: ThemeProp;
};

export const TitleScene: React.FC<TitleSceneProps> = ({
  title,
  subtitle,
  eyebrow,
  accentLabel,
  tags,
  footnote,
  motif = 'nodes',
  pace,
  accent = 'blue',
  theme,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const hasEyebrowRow = eyebrow !== undefined || accentLabel !== undefined;
  const hasSubtitle = subtitle !== undefined;
  const tagList = tags ?? [];
  // One beat per element that exists, so a card without an eyebrow does not
  // leave a hole in the pacing where one would have been.
  const beats = paceReveals((hasEyebrowRow ? 1 : 0) + 1 + (hasSubtitle ? 1 : 0) + tagList.length, {
    fps,
    durationInFrames,
    ...pace,
  });
  let cursor = 0;
  const eyebrowBeat = hasEyebrowRow ? beats[cursor++] : null;
  const titleBeat = beats[cursor++];
  const subtitleBeat = hasSubtitle ? beats[cursor++] : null;
  const tagBeats = beats.slice(cursor);

  const titleSize = fitFontSize(title, {
    size: TYPE.display.fontSize,
    maxWidth: TITLE_BOX.width,
    maxLines: TITLE_BOX.maxLines,
    minSize: TITLE_BOX.minSize,
    advance: ADVANCE.display,
  });
  const subtitleSize =
    subtitle === undefined
      ? TYPE.subheading.fontSize
      : fitFontSize(subtitle, {
          size: TYPE.subheading.fontSize,
          maxWidth: SUBTITLE_BOX.width,
          maxLines: SUBTITLE_BOX.maxLines,
          minSize: SUBTITLE_BOX.minSize,
          advance: ADVANCE.subheading,
        });

  return (
    <Frame
      name="Title scene"
      accent={accent}
      theme={theme}
      footer={footnote === undefined ? undefined : <FrameCaption accent={accent}>{footnote}</FrameCaption>}
    >
      {/* Background first so the text paints over it, and last in the reader's
          attention: the motif arrives with the title and takes a little longer
          to finish than the words do. */}
      {motif === 'none' ? null : (
        <Motif
          variant={motif}
          accent={accent}
          enter={{ delay: titleBeat.delay, duration: Math.round(titleBeat.duration * 1.6) }}
          style={{ right: -100, top: '50%', translate: '0 -50%' }}
        />
      )}

      <Column justify="center" style={{ height: '100%', gap: 0, maxWidth: TITLE_BOX.width, position: 'relative' }}>
        {eyebrowBeat === null ? null : (
          <Row gap={16} style={revealStyle('slideRight', frame, eyebrowBeat, 14)}>
            <AccentRule progress={1} width={38} accent={accent} thickness={4} />
            {eyebrow === undefined ? null : (
              <Text variant="label" tone="secondary">
                {eyebrow}
              </Text>
            )}
            {accentLabel === undefined ? null : (
              <Pill accent={accent} size="sm">
                {accentLabel}
              </Pill>
            )}
          </Row>
        )}

        <Text
          variant="display"
          // Clamped as a backstop: the fit above should make this a no-op, and
          // if a title ever beats the estimate, three lines and an ellipsis is
          // still a card rather than text over the canvas edge.
          clamp={TITLE_BOX.maxLines}
          style={{
            marginTop: hasEyebrowRow ? 30 : 0,
            maxWidth: TITLE_BOX.width,
            fontSize: titleSize,
            ...revealStyle('rise', frame, titleBeat, 36),
          }}
        >
          {title}
        </Text>

        {subtitle === undefined || subtitleBeat === null ? null : (
          <Text
            variant="subheading"
            tone="secondary"
            clamp={SUBTITLE_BOX.maxLines}
            style={{
              marginTop: 28,
              maxWidth: SUBTITLE_BOX.width,
              fontSize: subtitleSize,
              ...revealStyle('rise', frame, subtitleBeat, 28),
            }}
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
                {/* A pill is `nowrap` by design -- it exists to be one short
                    string -- so a tag that is long enough to beat the row is
                    ellipsised instead of pushing it off the canvas. */}
                <Pill mono accent={accent} style={{ maxWidth: '100%' }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tag}</span>
                </Pill>
              </Reveal>
            ))}
          </Row>
        )}
      </Column>
    </Frame>
  );
};
