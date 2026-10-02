/**
 * A note beside the thing it is about.
 *
 * Used where the narration says something the diagram cannot: a trade-off, a
 * caveat, the reason a queue exists at all. The tone carries the meaning --
 * `warn` for the thing that bites, `success` for the thing that saves you --
 * and resolves through the theme, so "warning" is still warning in a light
 * video.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { alpha, mix, toneAccent, type Accent, type Tone } from '../tokens.ts';
import { useTheme } from '../theme.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { Surface } from './Surface.tsx';
import { Text } from './Text.tsx';

export type CalloutProps = {
  title: string;
  body?: string;
  points?: string[];
  icon?: IconName;
  tone?: Tone;
  accent?: Accent;
  style?: CSSProperties;
};

export const Callout: React.FC<CalloutProps> = ({
  title,
  body,
  points,
  icon = 'bolt',
  tone = 'info',
  accent,
  style,
}) => {
  const theme = useTheme();
  const resolved = accent ?? toneAccent(tone);
  const tint = resolved === null ? theme.textSecondary : theme.accent[resolved];

  return (
    <Surface
      accent={resolved ?? undefined}
      pad={26}
      style={{ display: 'flex', gap: 18, alignItems: 'flex-start', ...style }}
    >
      <div
        style={{
          width: 46,
          height: 46,
          flexShrink: 0,
          borderRadius: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: resolved === null ? alpha(theme.borderStrong, 60) : mix(theme.accent[resolved], 16, theme.surface),
        }}
      >
        <Icon name={icon} size={25} color={tint} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <Text variant="subheading" style={{ fontWeight: 600 }}>
          {title}
        </Text>
        {body === undefined ? null : (
          <Text variant="small" tone="secondary">
            {body}
          </Text>
        )}
        {points === undefined
          ? null
          : points.map((point) => (
              <div key={point} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    marginTop: 12,
                    flexShrink: 0,
                    backgroundColor: tint,
                  }}
                />
                <Text variant="small" tone="secondary">
                  {point}
                </Text>
              </div>
            ))}
      </div>
    </Surface>
  );
};
