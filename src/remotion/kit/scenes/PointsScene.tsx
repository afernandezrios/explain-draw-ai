/**
 * The list scene: three to six things, one after another.
 *
 * `numbered` is for a sequence the viewer is meant to follow -- the steps of an
 * algorithm, the phases of a migration -- and `icon` for a set where the items
 * are peer concepts and the icon is the mnemonic. Both are the same component
 * because the difference really is the marker: title, body, spacing and pacing
 * are identical, and a second component would drift from this one.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { Accent } from '../tokens.ts';
import { SPACE, alpha, mix } from '../tokens.ts';
import { useTheme, type ThemeProp } from '../theme.tsx';
import { Frame, FrameCaption } from '../layout/Frame.tsx';
import { Grid } from '../layout/Stack.tsx';
import { Surface } from '../primitives/Surface.tsx';
import { Text } from '../primitives/Text.tsx';
import { Icon, type IconName } from '../primitives/Icon.tsx';
import { revealStyle } from '../animation/presets.ts';
import { paceReveals, type ScenePace } from '../animation/timing.ts';

export type PointItem = {
  title: string;
  body?: string;
  icon?: IconName;
  /** Defaults to the scene's accent. */
  accent?: Accent;
};

export type PointsSceneProps = {
  title: string;
  eyebrow?: string;
  points: PointItem[];
  variant?: 'numbered' | 'icon';
  columns?: 1 | 2;
  footnote?: string;
  /** Overrides the default entrance pacing. See `ScenePace`. */
  pace?: ScenePace;
  accent?: Accent;
  theme?: ThemeProp;
};

export const PointsScene: React.FC<PointsSceneProps> = ({
  title,
  eyebrow,
  points,
  variant = 'numbered',
  columns = 1,
  footnote,
  pace,
  accent = 'blue',
  theme,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  // Cards arrive in the order they are written, which is also the order they
  // are read: a grid fills left to right, top to bottom.
  const beats = paceReveals(points.length, { fps, durationInFrames, ...pace });

  return (
    <Frame
      name="Points scene"
      eyebrow={eyebrow}
      title={title}
      accent={accent}
      theme={theme}
      footer={footnote === undefined ? undefined : <FrameCaption accent={accent}>{footnote}</FrameCaption>}
    >
      <Grid columns={columns} gap={SPACE.lg} style={{ alignContent: 'center', height: '100%' }}>
        {points.map((point, index) => (
          <PointCard
            key={point.title}
            point={point}
            position={index + 1}
            variant={variant}
            fallbackAccent={accent}
            style={revealStyle('rise', frame, beats[index], 22)}
          />
        ))}
      </Grid>
    </Frame>
  );
};

const PointCard: React.FC<{
  point: PointItem;
  position: number;
  variant: 'numbered' | 'icon';
  fallbackAccent: Accent;
  style: React.CSSProperties;
}> = ({ point, position, variant, fallbackAccent, style }) => {
  const theme = useTheme();
  const accent = point.accent ?? fallbackAccent;
  const tint = theme.accent[accent];

  return (
    <Surface pad={SPACE.lg} style={{ display: 'flex', gap: 20, alignItems: 'flex-start', ...style }}>
      <div
        style={{
          width: 54,
          height: 54,
          flexShrink: 0,
          borderRadius: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: mix(tint, 16, theme.surface),
        }}
      >
        {variant === 'numbered' ? (
          <Text variant="subheading" accent={accent} mono style={{ fontWeight: 600 }}>
            {position}
          </Text>
        ) : (
          <Icon name={point.icon ?? 'check'} size={28} color={tint} />
        )}
      </div>
      <div style={{ minWidth: 0, paddingTop: 4 }}>
        <Text variant="heading" clamp={2}>
          {point.title}
        </Text>
        {point.body === undefined ? null : (
          <Text variant="body" tone="secondary" style={{ marginTop: 10 }}>
            {point.body}
          </Text>
        )}
      </div>
      <div
        style={{
          marginLeft: 'auto',
          alignSelf: 'center',
          width: 6,
          height: 6,
          borderRadius: 999,
          flexShrink: 0,
          backgroundColor: alpha(tint, 55),
        }}
      />
    </Surface>
  );
};
